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

    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');

    if (action === 'incoming') {
      // Handle incoming WhatsApp call
      const formData = await req.formData();
      const From = formData.get('From') as string; // Caller's WhatsApp number
      const To = formData.get('To') as string; // Business WhatsApp number

      console.log('WhatsApp call incoming:', { From, To });

      // Look up company by WhatsApp number
      const { data: company } = await supabase
        .from('companies')
        .select('*')
        .eq('whatsapp_number', To)
        .single();

      if (!company || !company.whatsapp_voice_enabled) {
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Sorry, voice calls are not available on this WhatsApp number at the moment.</Say>
</Response>`;
        return new Response(twiml, {
          headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
        });
      }

      // Check credit balance
      if (company.credit_balance <= 0) {
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">I'm sorry, our receptionist service is currently offline. Someone will call you back shortly.</Say>
</Response>`;
        return new Response(twiml, {
          headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
        });
      }

      // Create conversation
      const { data: conversation } = await supabase
        .from('conversations')
        .insert({
          company_id: company.id,
          phone: From,
          status: 'active',
          started_at: new Date().toISOString(),
          transcript: ''
        })
        .select()
        .single();

      // Deduct credits for call start
      await supabase.rpc('deduct_credits', {
        p_company_id: company.id,
        p_amount: 5,
        p_reason: 'whatsapp_call_start',
        p_conversation_id: conversation?.id
      });

      // Return TwiML to establish media stream
      const streamUrl = `wss://${req.headers.get('host')}/functions/v1/whatsapp-voice?action=stream&conversation_id=${conversation?.id}`;
      
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}" />
  </Connect>
</Response>`;

      return new Response(twiml, {
        headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
      });

    } else if (action === 'stream') {
      // Handle WebSocket media stream (similar to twilio-voice)
      const conversationId = searchParams.get('conversation_id');
      
      if (!conversationId) {
        throw new Error('conversation_id is required');
      }

      // Get conversation and company details
      const { data: conversation } = await supabase
        .from('conversations')
        .select('*, companies(*)')
        .eq('id', conversationId)
        .single();

      if (!conversation) {
        throw new Error('Conversation not found');
      }

      const company = conversation.companies;

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

      // Add quick reference info if available
      let quickRefInfo = '';
      if (company.quick_reference_info && company.quick_reference_info.trim()) {
        quickRefInfo = `\n\nKNOWLEDGE BASE (Important information about our business):\n${company.quick_reference_info}`;
      }

      const instructions = `You are the receptionist for ${company.name} in Zambia.
Business type: ${company.business_type}.
Voice style: ${company.voice_style}.
Business hours: ${company.hours}.
Locations / branches: ${company.branches}.
Areas or services: ${company.seating_areas} / ${company.menu_or_offerings}.
Currency: always use ${company.currency_prefix} (Kwacha).
Your job is to answer calls, help politely, and create/record bookings or appointments.
${dynamicInfo}
${quickRefInfo}

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
   Only call create_reservation after they clearly confirm yes.

5. If the line is noisy or unclear: say 'I'm sorry, the line is not clear. Can you please repeat that slowly for me?'
   If still unclear after 2 tries: say 'I'll ask a human to call you back to confirm. Thank you.' and DO NOT guess details.

6. NEVER invent, assume, or use default values. If unsure, ask.

7. Always speak in warm, respectful Zambian English (not American call center style).

8. Use natural Zambian phrasing and Kwacha prices using ${company.currency_prefix}.`;

      // Upgrade to WebSocket
      const upgrade = req.headers.get("upgrade") || "";
      if (upgrade.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }

      const { socket, response } = Deno.upgradeWebSocket(req);

      let openAiWs: WebSocket | null = null;
      let streamSid: string | null = null;

      socket.onopen = async () => {
        console.log('Twilio WebSocket connected for WhatsApp call');

        // Connect to OpenAI Realtime API
        const openAiUrl = `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17`;
        openAiWs = new WebSocket(openAiUrl, {
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'OpenAI-Beta': 'realtime=v1'
          }
        });

        openAiWs.onopen = () => {
          console.log('Connected to OpenAI Realtime');
          
          // Send session configuration
          openAiWs!.send(JSON.stringify({
            type: 'session.update',
            session: {
              modalities: ['text', 'audio'],
              instructions,
              voice: 'alloy',
              input_audio_format: 'g711_ulaw',
              output_audio_format: 'g711_ulaw',
              input_audio_transcription: {
                model: 'whisper-1'
              },
              turn_detection: {
                type: 'server_vad',
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 1000
              },
              tools: [
                {
                  type: "function",
                  name: "create_reservation",
                  description: "Create a booking ONLY after confirming all details with the customer. Never assume or invent information.",
                  parameters: {
                    type: "object",
                    properties: {
                      name: { type: "string", description: "Customer's actual full name as they provided it." },
                      phone: { type: "string", description: "Customer's actual phone number exactly as spoken." },
                      date: { type: "string", description: "Exact date requested in YYYY-MM-DD format" },
                      time: { type: "string", description: "Exact time requested in HH:MM 24-hour format" },
                      guests: { type: "number", description: "Exact number of guests" },
                      occasion: { type: "string", description: "The specific occasion as stated by customer." },
                      area_preference: { type: "string", description: "REQUIRED: The specific area or seating preference." },
                      branch: { type: "string", description: "REQUIRED: Which specific branch or location." },
                      email: { type: "string", description: "Customer's email address ONLY if they volunteer it." }
                    },
                    required: ["name", "phone", "date", "time", "guests", "area_preference", "branch"]
                  }
                }
              ],
              tool_choice: 'auto',
              temperature: 0.8
            }
          }));
        };

        openAiWs.onmessage = async (event) => {
          const data = JSON.parse(event.data);
          
          if (data.type === 'response.audio.delta' && data.delta) {
            // Forward audio to Twilio
            socket.send(JSON.stringify({
              event: 'media',
              streamSid,
              media: {
                payload: data.delta
              }
            }));
          } else if (data.type === 'response.function_call_arguments.done') {
            const args = JSON.parse(data.arguments);
            
            // Create reservation
            const { error: resError } = await supabase
              .from('reservations')
              .insert({
                company_id: company.id,
                conversation_id: conversationId,
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

            if (!resError) {
              console.log('Reservation created via WhatsApp call:', args);
              
              // Send confirmation email if email provided
              if (args.email) {
                try {
                  await supabase.functions.invoke('send-reservation-confirmation', {
                    body: {
                      name: args.name,
                      email: args.email,
                      date: args.date,
                      time: args.time,
                      guests: args.guests,
                      restaurantName: company.name
                    }
                  });
                  console.log('Confirmation email sent to:', args.email);
                } catch (emailError) {
                  console.error('Failed to send confirmation email:', emailError);
                }
              }
            } else {
              console.error('Error creating reservation:', resError);
            }
          } else if (data.type === 'input_audio_buffer.speech_started') {
            // Clear any ongoing audio playback
            socket.send(JSON.stringify({
              event: 'clear',
              streamSid
            }));
          }
        };

        openAiWs.onerror = (error) => {
          console.error('OpenAI WebSocket error:', error);
        };

        openAiWs.onclose = () => {
          console.log('OpenAI WebSocket closed');
        };
      };

      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (msg.event === 'start') {
          streamSid = msg.start.streamSid;
          console.log('WhatsApp media stream started:', streamSid);
        } else if (msg.event === 'media' && openAiWs && openAiWs.readyState === WebSocket.OPEN) {
          // Forward audio to OpenAI
          openAiWs.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: msg.media.payload
          }));
        } else if (msg.event === 'stop') {
          console.log('WhatsApp call ended');
          
          // Update conversation and trigger analysis
          supabase
            .from('conversations')
            .update({
              status: 'completed',
              ended_at: new Date().toISOString()
            })
            .eq('id', conversationId)
            .then(async () => {
              // Automatically analyze conversation for insights
              try {
                await supabase.functions.invoke('analyze-conversation', {
                  body: { conversation_id: conversationId }
                });
                console.log('Conversation analysis triggered');
              } catch (error) {
                console.error('Error triggering conversation analysis:', error);
              }
            });

          openAiWs?.close();
        }
      };

      socket.onerror = (error) => {
        console.error('Twilio WebSocket error:', error);
        openAiWs?.close();
      };

      socket.onclose = () => {
        console.log('Twilio WebSocket closed');
        openAiWs?.close();
      };

      return response;
    }

    return new Response('Invalid action', { status: 400, headers: corsHeaders });

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
