import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Parse Twilio WhatsApp webhook payload
    const formData = await req.formData();
    const From = formData.get('From') as string; // User's WhatsApp number
    const To = formData.get('To') as string; // Business WhatsApp number
    const Body = formData.get('Body') as string; // Message text

    console.log('WhatsApp message received:', { From, To, Body });

    // Look up company by WhatsApp number
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('*, metadata')
      .eq('whatsapp_number', To)
      .maybeSingle();

    if (companyError) {
      console.error('Database error looking up company:', companyError);
      return new Response(sendWhatsAppMessage(To, From, "Our service is temporarily unavailable. Please try again later."), {
        headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
      });
    }

    if (!company) {
      console.error('Company not found for WhatsApp number:', To);
      return new Response(sendWhatsAppMessage(To, From, "This WhatsApp number is not configured. Please contact support."), {
        headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
      });
    }

    // Check credit balance
    if (company.credit_balance <= 0) {
      const offlineMessage = "Our assistant is currently offline. A human will message you shortly.";
      
      // Send response via Twilio WhatsApp API
      const twilioResponse = await sendWhatsAppMessage(To, From, offlineMessage);
      
      return new Response(twilioResponse, {
        headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
      });
    }

    // Find or create active conversation
    let { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('*')
      .eq('company_id', company.id)
      .eq('phone', From)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (convError || !conversation) {
      const { data: newConv, error: createError } = await supabase
        .from('conversations')
        .insert({
          company_id: company.id,
          phone: From,
          status: 'active',
          transcript: ''
        })
        .select()
        .single();

      if (createError) {
        console.error('Error creating conversation:', createError);
        throw createError;
      }
      conversation = newConv;
    }

    // Deduct credits for WhatsApp message
    await supabase.rpc('deduct_credits', {
      p_company_id: company.id,
      p_amount: 1,
      p_reason: 'whatsapp_message',
      p_conversation_id: conversation.id
    });

    // Fetch AI overrides
    const { data: aiOverrides } = await supabase
      .from('company_ai_overrides')
      .select('*')
      .eq('company_id', company.id)
      .single();

    // Build comprehensive instructions
    let dynamicInfo = '';
    if (company.metadata && Object.keys(company.metadata).length > 0) {
      dynamicInfo = `\n\nREAL-TIME INFORMATION (Use this current data when answering):\n${JSON.stringify(company.metadata, null, 2)}`;
    }

    const instructions = `You are the receptionist for ${company.name} in Zambia.
Business type: ${company.business_type}.
Voice style: ${company.voice_style}.
Business hours: ${company.hours}.
Locations / branches: ${company.branches}.
Areas or services: ${company.seating_areas} / ${company.menu_or_offerings}.
Currency: always use ${company.currency_prefix} (Kwacha).
Your job is to answer messages, help politely, and create/record bookings or appointments.
${dynamicInfo}

${aiOverrides?.system_instructions || ''}

Answer style:
${aiOverrides?.qa_style || ''}

Do NOT talk about:
${aiOverrides?.banned_topics || ''}

Critical rules:

1. LISTEN CAREFULLY: Always capture the EXACT information the customer provides. Never use placeholder values or make assumptions.

2. Always ask for the caller's phone number FIRST and repeat it back in pairs, like '0977 12 34 56, correct?'.

3. ASK FOR REQUIRED DETAILS: If the customer doesn't mention which branch, area, or other required details, ASK them specifically:
   - "Which of our branches would you like to book at?"
   - "Would you prefer poolside, outdoor, or our main dining area?"

4. Before you create any reservation or appointment, ALWAYS repeat back ALL details and ask for confirmation:
   'Just to confirm: You are [EXACT NAME GIVEN], phone number [EXACT PHONE GIVEN], booking for [EXACT NUMBER] guests on [DATE] at [TIME] at our [EXACT BRANCH] in the [EXACT AREA], correct?'
   Only proceed to book after they clearly confirm yes.

5. If information is unclear, ask them to clarify. Do NOT guess details.

6. NEVER invent, assume, or use default values. If unsure, ask.

7. Always speak in warm, respectful Zambian English (not American call center style).

8. Use natural Zambian phrasing and Kwacha prices using ${company.currency_prefix}.`;

    // Build conversation history (last 10 exchanges)
    const transcriptLines = conversation.transcript.split('\n').filter((line: string) => line.trim());
    const recentHistory = transcriptLines.slice(-20).join('\n');

    const messages = [
      { role: 'system', content: instructions }
    ];

    if (recentHistory) {
      messages.push({ role: 'assistant', content: `Previous conversation context:\n${recentHistory}` });
    }

    messages.push({ role: 'user', content: Body });

    // Call OpenAI
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        tools: [
          {
            type: "function",
            name: "create_reservation",
            description: "Create a booking ONLY after confirming all details with the customer. Never assume or invent information.",
            parameters: {
              type: "object",
              properties: {
                name: { 
                  type: "string", 
                  description: "Customer's actual full name as they provided it. Do not use placeholders." 
                },
                phone: { 
                  type: "string", 
                  description: "Customer's actual phone number exactly as spoken. Include country code or leading 0. Repeat back to confirm." 
                },
                date: { 
                  type: "string", 
                  description: "Exact date requested by customer in YYYY-MM-DD format" 
                },
                time: { 
                  type: "string", 
                  description: "Exact time requested by customer in HH:MM 24-hour format" 
                },
                guests: { 
                  type: "number", 
                  description: "Exact number of guests the customer specified" 
                },
                occasion: { 
                  type: "string", 
                  description: "The specific occasion or reason for booking as stated by customer. Ask if not mentioned." 
                },
                area_preference: { 
                  type: "string", 
                  description: "REQUIRED: The specific area or seating preference the customer wants. Ask if not mentioned." 
                },
                branch: { 
                  type: "string", 
                  description: "REQUIRED: Which specific branch or location the customer wants to book at. Ask if not mentioned." 
                },
                email: { 
                  type: "string", 
                  description: "Customer's email address ONLY if they volunteer it." 
                }
              },
              required: ["name", "phone", "date", "time", "guests", "area_preference", "branch"]
            }
          }
        ],
        tool_choice: "auto"
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const aiData = await response.json();
    let assistantReply = aiData.choices[0].message.content || '';
    const toolCalls = aiData.choices[0].message.tool_calls;

    // Handle tool calls (reservation creation)
    if (toolCalls && toolCalls.length > 0) {
      for (const toolCall of toolCalls) {
        if (toolCall.function.name === 'create_reservation') {
          const args = JSON.parse(toolCall.function.arguments);
          
          // Insert reservation
          const { error: resError } = await supabase
            .from('reservations')
            .insert({
              company_id: company.id,
              conversation_id: conversation.id,
              name: args.name,
              phone: args.phone,
              email: args.email || null,
              date: args.date,
              time: args.time,
              guests: args.guests,
              occasion: args.occasion || null,
              area_preference: args.area_preference,
              branch: args.branch,
              status: 'confirmed'
            });

          if (resError) {
            console.error('Error creating reservation:', resError);
            assistantReply += "\n\nI encountered an error saving your reservation. Please contact us directly.";
          } else {
            assistantReply += "\n\nYour reservation has been confirmed! We look forward to serving you.";
          }
        }
      }
    }

    // Update conversation transcript
    const updatedTranscript = `${conversation.transcript}\nCustomer: ${Body}\nAssistant: ${assistantReply}\n`;
    await supabase
      .from('conversations')
      .update({ transcript: updatedTranscript })
      .eq('id', conversation.id);

    // Send response via Twilio WhatsApp API
    const twilioResponse = await sendWhatsAppMessage(To, From, assistantReply);

    return new Response(twilioResponse, {
      headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
    });

  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function sendWhatsAppMessage(from: string, to: string, body: string): string {
  // Return TwiML for WhatsApp response
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${body}</Message>
</Response>`;
}
