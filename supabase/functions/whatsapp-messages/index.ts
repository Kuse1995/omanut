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
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[Our service is temporarily unavailable. Please try again later.]]></Message>
</Response>`, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
      });
    }

    if (!company) {
      console.error('Company not found for WhatsApp number:', To);
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[This WhatsApp number is not configured. Please contact support.]]></Message>
</Response>`, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
      });
    }

    // Check credit balance
    if (company.credit_balance <= 0) {
      const offlineMessage = "Our assistant is currently offline. A human will message you shortly.";
      
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[${offlineMessage}]]></Message>
</Response>`, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
      });
    }

    // Extract phone number from WhatsApp format (remove "whatsapp:" prefix)
    const customerPhone = From.replace('whatsapp:', '');
    
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
          transcript: `CUSTOMER PHONE: ${customerPhone}\n`
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

    // Get company documents for knowledge base
    const { data: documents } = await supabase
      .from('company_documents')
      .select('filename, parsed_content')
      .eq('company_id', company.id)
      .not('parsed_content', 'is', null);

    // Build knowledge base from documents
    let knowledgeBase = '';
    if (documents && documents.length > 0) {
      knowledgeBase = '\n\n📚 COMPANY KNOWLEDGE BASE (Use this to answer customer questions):\n';
      documents.forEach(doc => {
        if (doc.parsed_content) {
          knowledgeBase += `\n--- ${doc.filename} ---\n${doc.parsed_content}\n`;
        }
      });
      knowledgeBase += '\nWhen customers ask questions, check this knowledge base FIRST for accurate information.\n';
    }

    // Build comprehensive instructions
    let dynamicInfo = '';
    if (company.metadata && Object.keys(company.metadata).length > 0) {
      dynamicInfo = `\n\nREAL-TIME INFORMATION (Use this current data when answering):\n${JSON.stringify(company.metadata, null, 2)}`;
    }

    // Add quick reference info if available
    let quickRefInfo = '';
    if (company.quick_reference_info && company.quick_reference_info.trim()) {
      quickRefInfo = `\n\nQUICK REFERENCE INFO:\n${company.quick_reference_info}\n`;
    }

    // Get current date for AI context
    const today = new Date();
    const currentDate = today.toISOString().split('T')[0]; // YYYY-MM-DD format
    const dayOfWeek = today.toLocaleDateString('en-US', { weekday: 'long' });
    
    const instructions = `You are the receptionist for ${company.name} in Zambia.
Business type: ${company.business_type}.
Voice style: ${company.voice_style}.
Business hours: ${company.hours}.
Locations / branches: ${company.branches}.
Areas or services: ${company.seating_areas} / ${company.menu_or_offerings}.
Currency: always use ${company.currency_prefix} (Kwacha).
Your job is to answer messages, help politely, and create/record bookings or appointments.

CRITICAL DATE INFORMATION:
- Today's date is: ${currentDate} (${dayOfWeek})
- When customers say "today", "tomorrow", or "next week", calculate the correct date based on ${currentDate}
- ALWAYS use dates in YYYY-MM-DD format
- If a customer says "tomorrow", add 1 day to ${currentDate}
- If a customer mentions "next Monday", calculate from ${currentDate}

${quickRefInfo}
${knowledgeBase}
IMPORTANT: The customer is messaging from WhatsApp number ${customerPhone}. This is their contact number - you already have it. DO NOT ask for their phone number again.

${dynamicInfo}

${aiOverrides?.system_instructions || ''}

Answer style:
${aiOverrides?.qa_style || ''}

Do NOT talk about:
${aiOverrides?.banned_topics || ''}

Critical rules:

1. CUSTOMER PHONE: ${customerPhone} - You ALREADY HAVE this. Never ask for it again.

2. When answering questions, ALWAYS check the Company Knowledge Base first for accurate information.

3. When taking a booking, you only need to ask for:
   - Their NAME (ask once: "May I have your name please?")
   - DATE and TIME of booking
   - NUMBER OF GUESTS
   - WHICH BRANCH (if multiple locations)
   - SEATING PREFERENCE (if applicable)
   
4. NEVER ask for the same information twice. Once they give you their name, use it in the conversation.

5. Before creating a reservation, confirm ALL details ONCE:
   "Perfect! Let me confirm: [NAME], ${customerPhone}, [GUESTS] guests on [DATE] at [TIME] at our [BRANCH], [AREA]. Is that correct?"
   Only call create_reservation after they confirm.

6. Track what information you already have. Look at the conversation history to see what they've told you.

7. Be concise and natural. Don't sound like a robot repeating questions.

8. Always speak in warm, respectful Zambian English.

9. Use natural Zambian phrasing and Kwacha prices using ${company.currency_prefix}.`;

    // Build conversation history - keep full context to avoid repetition
    const transcriptLines = conversation.transcript.split('\n').filter((line: string) => line.trim());
    const recentHistory = transcriptLines.join('\n');

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
            function: {
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

    console.log('AI response:', { assistantReply, toolCalls });

    // Handle tool calls (reservation creation)
    if (toolCalls && toolCalls.length > 0) {
      for (const toolCall of toolCalls) {
        if (toolCall.function.name === 'create_reservation') {
          const args = JSON.parse(toolCall.function.arguments);
          
          // Use WhatsApp phone number if not provided in args
          const reservationPhone = args.phone || customerPhone;
          
          // Insert reservation
          const { error: resError } = await supabase
            .from('reservations')
            .insert({
              company_id: company.id,
              conversation_id: conversation.id,
              name: args.name,
              phone: reservationPhone,
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
            // Update conversation with customer name
            await supabase
              .from('conversations')
              .update({ customer_name: args.name })
              .eq('id', conversation.id);
              
            assistantReply += "\n\nYour reservation has been confirmed! We look forward to serving you.";
          }
        }
      }
    }

    // Extract customer name if they introduce themselves
    let customerName = conversation.customer_name;
    if (!customerName && Body) {
      const namePatterns = [
        /(?:my name is|i am|i'm|this is)\s+([a-z]+(?:\s+[a-z]+)?)/i,
        /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)$/
      ];
      for (const pattern of namePatterns) {
        const match = Body.match(pattern);
        if (match && match[1] && match[1].length > 2) {
          customerName = match[1];
          await supabase
            .from('conversations')
            .update({ customer_name: customerName })
            .eq('id', conversation.id);
          break;
        }
      }
    }

    // Ensure we always have a response
    if (!assistantReply || assistantReply.trim() === '') {
      assistantReply = "Thank you for your message. How can I help you today?";
      console.log('Warning: Empty AI response, using fallback message');
    }
    
    console.log('Final assistant reply to send:', assistantReply);

    // Insert user message into messages table
    await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        role: 'user',
        content: Body
      });

    // Insert assistant message into messages table
    await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        role: 'assistant',
        content: assistantReply
      });

    // Update conversation transcript (keep for backward compatibility)
    const updatedTranscript = `${conversation.transcript}\nCustomer: ${Body}\nAssistant: ${assistantReply}\n`;
    await supabase
      .from('conversations')
      .update({ transcript: updatedTranscript })
      .eq('id', conversation.id);

    console.log('Sending WhatsApp response:', assistantReply);

    // Return TwiML response for Twilio to send the message
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[${assistantReply}]]></Message>
</Response>`;

    return new Response(twimlResponse, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
    });

  } catch (error) {
    console.error("Error in WhatsApp handler:", error);
    // Return TwiML error response so user gets a message
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[Sorry, I encountered an error. Please try again or contact us directly.]]></Message>
</Response>`, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
    });
  }
});
