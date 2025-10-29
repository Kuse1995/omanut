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
            
            // Check credit balance before allowing call
            if (company && company.credit_balance <= 0) {
              console.log('Insufficient credits for company:', company.id);
              // Send low credit message and end call
              twilioSocket.send(JSON.stringify({
                event: 'media',
                streamSid: message.start?.streamSid,
                media: {
                  payload: '' // Send empty to trigger end
                }
              }));
              return;
            }
            
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
          // Fetch AI overrides for this company
          const { data: aiOverrides } = await supabase
            .from('company_ai_overrides')
            .select('*')
            .eq('company_id', company?.id)
            .single();
          
          // Build comprehensive instructions
          let instructions = `You are the receptionist for ${company.name} in Zambia.
Business type: ${company.business_type}.
Voice style: ${company.voice_style}.
Business hours: ${company.hours}.
Locations / branches: ${company.branches}.
Areas or services: ${company.seating_areas} / ${company.menu_or_offerings}.
Currency: always use ${company.currency_prefix} (Kwacha).
Your job is to answer calls, help politely, and create/record bookings or appointments.

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
                        description: 'Create a booking ONLY after confirming all details with the customer. Never assume or invent information.',
                        parameters: {
                          type: 'object',
                          properties: {
                            name: { type: 'string', description: 'Customer\'s actual full name as they provided it. Do not use placeholders.' },
                            phone: { type: 'string', description: 'Customer\'s actual phone number exactly as spoken. Include country code or leading 0. Repeat back to confirm.' },
                            date: { type: 'string', description: 'Exact date requested by customer in YYYY-MM-DD format' },
                            time: { type: 'string', description: 'Exact time requested by customer in HH:MM 24-hour format' },
                            guests: { type: 'number', description: 'Exact number of guests the customer specified' },
                            occasion: { type: 'string', description: 'The specific occasion or reason for booking as stated by customer. Ask if not mentioned. Examples: birthday, anniversary, business meeting, family dinner, etc.' },
                            area_preference: { type: 'string', description: 'REQUIRED: The specific area or seating preference the customer wants. Ask if not mentioned. Examples: poolside, outdoor terrace, VIP lounge, main dining, garden, etc.' },
                            branch: { type: 'string', description: 'REQUIRED: Which specific branch or location the customer wants to book at. Ask if not mentioned. Examples: Main Branch, Solwezi, Lusaka North, etc.' },
                            email: { type: 'string', description: 'Customer\'s email address ONLY if they volunteer it. Do not ask unless they want confirmation sent.' }
                          },
                          required: ['name', 'phone', 'date', 'time', 'guests', 'area_preference', 'branch']
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
            } else if (aiMessage.type === 'conversation.item.input_audio_transcription.completed') {
              // Log caller transcript
              if (conversationId && aiMessage.transcript) {
                // Insert into messages table
                await supabase
                  .from('messages')
                  .insert({
                    conversation_id: conversationId,
                    role: 'user',
                    content: aiMessage.transcript
                  });

                // Update transcript field (for backward compatibility)
                const { data: conv } = await supabase
                  .from('conversations')
                  .select('transcript')
                  .eq('id', conversationId)
                  .single();
                
                const updatedTranscript = (conv?.transcript || '') + `\nCaller: ${aiMessage.transcript}`;
                await supabase
                  .from('conversations')
                  .update({ transcript: updatedTranscript })
                  .eq('id', conversationId);
              }
            } else if (aiMessage.type === 'response.audio_transcript.delta') {
              // Log assistant transcript (accumulate deltas)
              if (conversationId && aiMessage.delta) {
                audioBuffer += aiMessage.delta;
                
                // Update transcript field (for backward compatibility)
                const { data: conv } = await supabase
                  .from('conversations')
                  .select('transcript')
                  .eq('id', conversationId)
                  .single();
                
                const updatedTranscript = (conv?.transcript || '') + aiMessage.delta;
                await supabase
                  .from('conversations')
                  .update({ transcript: updatedTranscript })
                  .eq('id', conversationId);
              }
            } else if (aiMessage.type === 'response.done') {
              // When response is complete, insert the accumulated audio transcript
              if (conversationId && audioBuffer.trim()) {
                await supabase
                  .from('messages')
                  .insert({
                    conversation_id: conversationId,
                    role: 'assistant',
                    content: audioBuffer.trim()
                  });
                audioBuffer = ''; // Reset buffer
              }
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

                  // Append reservation summary to transcript
                  if (conversationId) {
                    const { data: conv } = await supabase
                      .from('conversations')
                      .select('transcript')
                      .eq('id', conversationId)
                      .single();
                    
                    const summary = `\n[System]: Reservation captured for ${args.name} on ${args.date} at ${args.time}, ${args.guests} guests, ${args.area_preference || 'main area'}.`;
                    await supabase
                      .from('conversations')
                      .update({ transcript: (conv?.transcript || '') + summary })
                      .eq('id', conversationId);
                  }

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

            // Automatically analyze conversation for insights
            try {
              await supabase.functions.invoke('analyze-conversation', {
                body: { conversation_id: conversationId }
              });
              console.log('Conversation analysis triggered');
            } catch (error) {
              console.error('Error triggering conversation analysis:', error);
            }
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