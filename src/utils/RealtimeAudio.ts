import { supabase } from "@/integrations/supabase/client";

export class AudioRecorder {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  constructor(private onAudioData: (audioData: Float32Array) => void) {}

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      this.audioContext = new AudioContext({
        sampleRate: 24000,
      });
      
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      
      this.processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        this.onAudioData(new Float32Array(inputData));
      };
      
      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);
    } catch (error) {
      console.error('Error accessing microphone:', error);
      throw error;
    }
  }

  stop() {
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}

export const encodeAudioForAPI = (float32Array: Float32Array): string => {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  
  const uint8Array = new Uint8Array(int16Array.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  
  return btoa(binary);
};

export class RealtimeChat {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private audioEl: HTMLAudioElement;
  private recorder: AudioRecorder | null = null;
  private conversationId: string | null = null;

  constructor(
    private onMessage: (message: any) => void,
    private onStatusChange: (status: string) => void
  ) {
    this.audioEl = document.createElement("audio");
    this.audioEl.autoplay = true;
  }

  async init() {
    try {
      this.onStatusChange("Connecting…");

      // Get first company for web demo (in production, use logged-in user's company)
      const { data: company } = await supabase
        .from('companies')
        .select('*')
        .limit(1)
        .single();

      // Create conversation record with company_id
      const { data: convData, error: convError } = await supabase
        .from('conversations')
        .insert({ 
          status: 'active',
          company_id: company?.id
        })
        .select()
        .single();

      if (convError) throw convError;
      this.conversationId = convData.id;
      
      // Deduct credits for demo start
      if (company?.id && this.conversationId) {
        await supabase.rpc('deduct_credits', {
          p_company_id: company.id,
          p_amount: 5,
          p_reason: 'demo_start',
          p_conversation_id: this.conversationId
        });
      }

      // Get ephemeral token from edge function
      const { data: tokenData, error: tokenError } = await supabase.functions.invoke(
        "realtime-session"
      );

      if (tokenError) throw tokenError;

      const EPHEMERAL_KEY = tokenData.client_secret?.value;
      if (!EPHEMERAL_KEY) {
        throw new Error("Failed to get ephemeral token");
      }

      // Create peer connection
      this.pc = new RTCPeerConnection();

      // Set up remote audio
      this.pc.ontrack = e => {
        this.audioEl.srcObject = e.streams[0];
        this.onStatusChange("Talking to Guest");
      };

      // Add local audio track
      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.pc.addTrack(ms.getTracks()[0]);

      // Set up data channel
      this.dc = this.pc.createDataChannel("oai-events");
      this.dc.addEventListener("message", async (e) => {
        const event = JSON.parse(e.data);
        console.log("Received event:", event);
        this.onMessage(event);

        if (event.type === 'response.audio.delta') {
          this.onStatusChange("Talking to Guest");
        } else if (event.type === 'response.audio.done') {
          this.onStatusChange("Ready");
        } else if (event.type === 'session.created') {
          await this.configureSession();
        } else if (event.type === 'response.function_call_arguments.done') {
          await this.handleReservation(event);
        } else if (event.type === 'error') {
          this.onStatusChange("Bad Network / Repeating Question");
        } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
          // Log caller transcript
          if (this.conversationId && event.transcript) {
            const { data: conv } = await supabase
              .from('conversations')
              .select('transcript')
              .eq('id', this.conversationId)
              .single();
            
            const updatedTranscript = (conv?.transcript || '') + `\nCaller: ${event.transcript}`;
            await supabase
              .from('conversations')
              .update({ transcript: updatedTranscript })
              .eq('id', this.conversationId);
          }
        } else if (event.type === 'response.audio_transcript.delta') {
          // Log assistant transcript
          if (this.conversationId && event.delta) {
            const { data: conv } = await supabase
              .from('conversations')
              .select('transcript')
              .eq('id', this.conversationId)
              .single();
            
            const updatedTranscript = (conv?.transcript || '') + event.delta;
            await supabase
              .from('conversations')
              .update({ transcript: updatedTranscript })
              .eq('id', this.conversationId);
          }
        }
      });

      // Create and set local description
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      // Connect to OpenAI's Realtime API
      const baseUrl = "https://api.openai.com/v1/realtime";
      const model = "gpt-4o-realtime-preview-2024-12-17";
      const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${EPHEMERAL_KEY}`,
          "Content-Type": "application/sdp"
        },
      });

      const answer = {
        type: "answer" as RTCSdpType,
        sdp: await sdpResponse.text(),
      };
      
      await this.pc.setRemoteDescription(answer);
      console.log("WebRTC connection established");
      this.onStatusChange("Ready");

      // Start recording
      this.recorder = new AudioRecorder((audioData) => {
        if (this.dc?.readyState === 'open') {
          this.dc.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: encodeAudioForAPI(audioData)
          }));
        }
      });
      await this.recorder.start();

    } catch (error) {
      console.error("Error initializing chat:", error);
      this.onStatusChange("Error");
      throw error;
    }
  }

  private async configureSession() {
    try {
      // Fetch company config (use first company for web demo)
      const { data: company } = await supabase
        .from('companies')
        .select('*')
        .limit(1)
        .single();

      if (!company) return;

      // Fetch AI overrides for this company
      const { data: aiOverrides } = await supabase
        .from('company_ai_overrides')
        .select('*')
        .eq('company_id', company.id)
        .single();

      // Check credit balance
      if (company.credit_balance <= 0) {
        this.onStatusChange("Insufficient Credits");
        throw new Error("Insufficient credits to start demo");
      }

      let instructions = `You are the receptionist for ${company.name} in Zambia. Business type: ${company.business_type}. ${company.voice_style} Hours: ${company.hours}. Offerings: ${company.menu_or_offerings}. Branches: ${company.branches}. Seating areas: ${company.seating_areas}. Use ${company.currency_prefix} for prices. Say prices like '${company.currency_prefix}180', never in dollars.

CRITICAL ACCURACY RULES:
1. ALWAYS ask for the caller's phone number FIRST. Then repeat it back in pairs, e.g. "0977 12 34 56, correct?" Wait for confirmation.
2. BEFORE calling create_reservation, you MUST confirm ALL details: "Just to confirm: You are [NAME], phone number [PHONE], booking for [GUESTS] people on [DATE] at [TIME] in [AREA/BRANCH], correct?" Only proceed after they say "yes".
3. If the line is noisy or unclear, NEVER guess. Say: "I'm sorry, the line is not clear. Can you please repeat that slowly for me?" After 2 failed attempts, say: "I'll ask a human to call you back to confirm. Thank you." and end the booking attempt.
4. NEVER invent details. If you don't know something, ask the caller.
5. If they don't have email, say 'No problem, we can still keep your booking.'
6. Be friendly, warm, and local — not American call center tone.`;
      
      // Append AI overrides if they exist
      if (aiOverrides) {
        if (aiOverrides.system_instructions) {
          instructions += `\n\nADDITIONAL INSTRUCTIONS: ${aiOverrides.system_instructions}`;
        }
        if (aiOverrides.qa_style) {
          instructions += `\n\nQA STYLE: ${aiOverrides.qa_style}`;
        }
        if (aiOverrides.banned_topics) {
          instructions += `\n\nBANNED TOPICS: ${aiOverrides.banned_topics}`;
        }
      }

      const sessionUpdate = {
        type: "session.update",
        session: {
          modalities: ["text", "audio"],
          instructions,
          voice: "alloy",
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          input_audio_transcription: {
            model: "whisper-1"
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 1000
          },
          tools: [
            {
              type: "function",
              name: "create_reservation",
              description: "Create a booking for a table / event / poolside area at the lodge in Zambia",
              parameters: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Customer first name" },
                  phone: { type: "string", description: "Zambian phone number, include leading 0 e.g. 0977..." },
                  date: { type: "string", description: "YYYY-MM-DD" },
                  time: { type: "string", description: "HH:MM (24h local time)" },
                  guests: { type: "number", description: "How many people" },
                  occasion: { type: "string", description: "Birthday, meeting, romantic dinner, Independence celebration, etc." },
                  area_preference: { type: "string", description: "poolside, outdoor, VIP, conference hall, etc." },
                  branch: { type: "string", description: "Which branch (e.g. Main, Solwezi). Default 'Main' if not said." },
                  email: { type: "string", description: "Customer email, ONLY if they volunteer it" }
                },
                required: ["name", "phone", "date", "time", "guests"]
              }
            }
          ],
          tool_choice: "auto",
          temperature: 0.8
        }
      };

      if (this.dc?.readyState === 'open') {
        this.dc.send(JSON.stringify(sessionUpdate));
      }
    } catch (error) {
      console.error("Error configuring session:", error);
    }
  }

  private async handleReservation(event: any) {
    try {
      const args = JSON.parse(event.arguments);
      
      // Get company from conversation
      const { data: conversation } = await supabase
        .from('conversations')
        .select('company_id, companies(*)')
        .eq('id', this.conversationId)
        .single();
      
      const companyId = conversation?.company_id;
      const companyName = conversation?.companies?.name || 'Your Business';
      
      // Insert reservation with company_id
      const { data: reservation, error: resError } = await supabase
        .from('reservations')
        .insert({
          conversation_id: this.conversationId,
          company_id: companyId,
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

      if (resError) throw resError;

      // Send confirmation email if email provided
      if (args.email) {
        await supabase.functions.invoke('send-reservation-confirmation', {
          body: {
            name: args.name,
            email: args.email,
            date: args.date,
            time: args.time,
            guests: args.guests,
            restaurantName: companyName
          }
        });
      }

      console.log("Reservation created:", reservation);
    } catch (error) {
      console.error("Error handling reservation:", error);
    }
  }

  disconnect() {
    this.recorder?.stop();
    this.dc?.close();
    this.pc?.close();
    
    // Update conversation status
    if (this.conversationId) {
      supabase
        .from('conversations')
        .update({ 
          status: 'completed',
          ended_at: new Date().toISOString()
        })
        .eq('id', this.conversationId)
        .then(() => console.log("Conversation ended"));
    }
  }
}