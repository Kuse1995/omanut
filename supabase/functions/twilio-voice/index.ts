import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const pathname = url.pathname;

  // Handle /twiml endpoint - returns TwiML XML
  if (pathname.includes('/twiml')) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const projectId = supabaseUrl.replace('https://', '').split('.')[0];
    
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman">Hello. Please hold while I connect you to our lodge assistant.</Say>
  <Connect>
    <Stream url="wss://${projectId}.supabase.co/functions/v1/twilio-voice/media-stream" />
  </Connect>
</Response>`;

    return new Response(twiml, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/xml'
      }
    });
  }

  // Handle /media-stream endpoint - WebSocket upgrade
  if (pathname.includes('/media-stream')) {
    const { headers } = req;
    const upgradeHeader = headers.get("upgrade") || "";

    if (upgradeHeader.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket connection", { status: 400 });
    }

    const { socket: twilioSocket, response } = Deno.upgradeWebSocket(req);
    
    let openAISocket: WebSocket | null = null;
    let conversationId: string | null = null;
    let currentCallSid: string | null = null;
    let audioBuffer = '';

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    let company: any = null;

    twilioSocket.onopen = async () => {
      console.log('Twilio WebSocket connected');
    };

    twilioSocket.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('Twilio event:', message.event);

        if (message.event === 'start') {
          currentCallSid = message.start?.callSid;
          const twilioNumber = message.start?.customParameters?.To;
          console.log('Call started:', currentCallSid, 'To:', twilioNumber);
          
          // Fetch company by Twilio number
          const { data: companyData } = await supabase
            .from('companies')
            .select('*')
            .eq('twilio_number', twilioNumber)
            .single();
          
          if (!companyData) {
            console.log('No company found for number, using first company');
            const { data: fallback } = await supabase
              .from('companies')
              .select('*')
              .limit(1)
              .single();
            company = fallback;
          } else {
            company = companyData;
          }
          
          // Create conversation with company_id
          const { data: convData, error: convError } = await supabase
            .from('conversations')
            .insert({ 
              status: 'active',
              company_id: company?.id
            })
            .select()
            .single();

          if (!convError && convData) {
            conversationId = convData.id;
            console.log('Created conversation:', conversationId);
            
            // Deduct credits for call start
            if (company?.id) {
              await supabase.rpc('deduct_credits', {
                p_company_id: company.id,
                p_amount: 5,
                p_reason: 'call_start',
                p_conversation_id: conversationId
              });
            }
          }

          // Connect to OpenAI Realtime
          const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
          if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');

          openAISocket = new WebSocket(
            'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01',
            {
              headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'OpenAI-Beta': 'realtime=v1'
              }
            }
          );

          openAISocket.onopen = () => {
            console.log('OpenAI WebSocket connected');
          };

          openAISocket.onmessage = async (aiEvent) => {
            const aiMessage = JSON.parse(aiEvent.data);
            console.log('OpenAI event:', aiMessage.type);

            if (aiMessage.type === 'session.created') {
              // Configure session with dynamic company persona
              const instructions = company
                ? `You are the receptionist for ${company.name} in Zambia. Business type: ${company.business_type}. ${company.voice_style} Hours: ${company.hours}. Offerings: ${company.menu_or_offerings}. Branches: ${company.branches}. Seating areas: ${company.seating_areas}. Use ${company.currency_prefix} for prices. Say prices like '${company.currency_prefix}180', never in dollars. Always ask for the caller's phone number first so we can call or WhatsApp them back. If they don't have email, say 'No problem, we can still keep your booking.' If network is noisy or it cuts, politely ask them to repeat instead of guessing. Be friendly, warm, and local — not American call center tone.`
                : 'You are a helpful receptionist at a Zambian business. Always collect phone number first and use Kwacha for prices.';

              if (company) {

                openAISocket?.send(JSON.stringify({
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
                        type: 'function',
                        name: 'create_reservation',
                        description: 'Create a booking for a table / event / poolside area at the lodge in Zambia',
                        parameters: {
                          type: 'object',
                          properties: {
                            name: { type: 'string', description: 'Customer first name' },
                            phone: { type: 'string', description: 'Zambian phone number, include leading 0 e.g. 0977...' },
                            date: { type: 'string', description: 'YYYY-MM-DD' },
                            time: { type: 'string', description: 'HH:MM (24h local time)' },
                            guests: { type: 'number', description: 'How many people' },
                            occasion: { type: 'string', description: 'Birthday, meeting, romantic dinner, Independence celebration, etc.' },
                            area_preference: { type: 'string', description: 'poolside, outdoor, VIP, conference hall, etc.' },
                            branch: { type: 'string', description: 'Which branch (e.g. Main, Solwezi). Default Main if not said.' },
                            email: { type: 'string', description: 'Customer email, ONLY if they volunteer it' }
                          },
                          required: ['name', 'phone', 'date', 'time', 'guests']
                        }
                      }
                    ],
                    tool_choice: 'auto',
                    temperature: 0.8
                  }
                }));
              }
            } else if (aiMessage.type === 'response.audio.delta') {
              // Send audio back to Twilio
              twilioSocket.send(JSON.stringify({
                event: 'media',
                streamSid: message.start?.streamSid,
                media: {
                  payload: aiMessage.delta
                }
              }));
            } else if (aiMessage.type === 'response.function_call_arguments.done') {
              // Handle reservation
              try {
                const args = JSON.parse(aiMessage.arguments);
                
                const { data: reservation, error: resError } = await supabase
                  .from('reservations')
                  .insert({
                    conversation_id: conversationId,
                    company_id: company?.id,
                    name: args.name,
                    phone: args.phone,
                    email: args.email || null,
                    date: args.date,
                    time: args.time,
                    guests: args.guests,
                    occasion: args.occasion || null,
                    area_preference: args.area_preference || null,
                    branch: args.branch || 'Main',
                    status: 'confirmed'
                  })
                  .select()
                  .single();

                if (!resError && reservation) {
                  console.log('Reservation created:', reservation.id);

                  // Send email if provided
                  if (args.email && company) {
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
                  }
                }
              } catch (err) {
                console.error('Error creating reservation:', err);
              }
            }
          };

          openAISocket.onerror = (error) => {
            console.error('OpenAI WebSocket error:', error);
          };
        } else if (message.event === 'media') {
          // Forward audio to OpenAI
          if (openAISocket?.readyState === WebSocket.OPEN) {
            openAISocket.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: message.media.payload
            }));
          }
        } else if (message.event === 'stop') {
          console.log('Call stopped');
          
          // Update conversation
          if (conversationId) {
            await supabase
              .from('conversations')
              .update({
                status: 'completed',
                ended_at: new Date().toISOString()
              })
              .eq('id', conversationId);
          }

          openAISocket?.close();
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
    };

    twilioSocket.onclose = () => {
      console.log('Twilio WebSocket closed');
      openAISocket?.close();
    };

    return response;
  }

  return new Response('Not found', { status: 404, headers: corsHeaders });
});