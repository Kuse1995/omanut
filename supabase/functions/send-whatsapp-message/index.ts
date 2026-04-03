import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function normalizeWhatsAppTo(phone: string): string {
  const clean = phone.replace(/^whatsapp:/, '');
  return clean.startsWith('+') ? `whatsapp:${clean}` : `whatsapp:+${clean}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { conversationId, message, mediaUrl, phone, company_id, media_url } = await req.json();
    const effectiveMediaUrl = mediaUrl || media_url;

    // Determine auth mode: JWT (admin panel) or service-role (MCP/internal)
    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;
    let isServiceRole = false;

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      // Check if it's the service role key
      if (token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
        isServiceRole = true;
        console.log('[send-whatsapp-message] Service-role auth');
      } else {
        // Validate as user JWT
        const userClient = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_ANON_KEY')!,
          { global: { headers: { Authorization: authHeader } } }
        );
        const { data: { user }, error: authError } = await userClient.auth.getUser(token);
        if (authError || !user) {
          console.error('Auth validation failed:', authError);
          return new Response(
            JSON.stringify({ error: 'Unauthorized' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        userId = user.id;
      }
    } else {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Resolve conversation: by ID, or by phone+company_id lookup
    let conversation: any = null;

    if (conversationId) {
      const { data, error } = await supabase
        .from('conversations')
        .select('*, companies(twilio_number, whatsapp_number)')
        .eq('id', conversationId)
        .single();
      if (error || !data) {
        console.error('Error fetching conversation:', error);
        return new Response(
          JSON.stringify({ error: 'Conversation not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      conversation = data;
    } else if (phone && company_id) {
      // Phone-based lookup (for MCP/internal calls)
      // Normalize phone for matching: strip whatsapp: prefix
      const cleanPhone = phone.replace(/^whatsapp:/, '');
      
      // Try to find existing conversation by phone
      const { data: convs } = await supabase
        .from('conversations')
        .select('*, companies(twilio_number, whatsapp_number)')
        .eq('company_id', company_id)
        .or(`phone.eq.${cleanPhone},phone.eq.whatsapp:${cleanPhone}`)
        .order('started_at', { ascending: false })
        .limit(1);

      if (convs && convs.length > 0) {
        conversation = convs[0];
      } else {
        // Create a new conversation
        const { data: company } = await supabase
          .from('companies')
          .select('twilio_number, whatsapp_number')
          .eq('id', company_id)
          .single();

        const { data: newConv, error: createErr } = await supabase
          .from('conversations')
          .insert({
            company_id,
            phone: cleanPhone,
            platform: 'whatsapp',
            status: 'active',
          })
          .select('*, companies(twilio_number, whatsapp_number)')
          .single();

        if (createErr || !newConv) {
          console.error('Error creating conversation:', createErr);
          return new Response(
            JSON.stringify({ error: 'Failed to create conversation' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        conversation = newConv;
      }
    } else {
      return new Response(
        JSON.stringify({ error: 'conversationId or (phone + company_id) required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!message && !effectiveMediaUrl) {
      return new Response(
        JSON.stringify({ error: 'message or mediaUrl required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Authorization check: JWT users must belong to the company
    if (userId && !isServiceRole) {
      const { data: accessData } = await supabase
        .from('company_users')
        .select('id')
        .eq('user_id', userId)
        .eq('company_id', conversation.company_id)
        .maybeSingle();

      if (!accessData) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Insert message into database
    const { error: msgError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        role: 'assistant',
        content: message || (effectiveMediaUrl ? 'Sent an attachment' : '')
      });

    if (msgError) {
      console.error('Error inserting message:', msgError);
      return new Response(
        JSON.stringify({ error: 'Failed to save message' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Send message via Twilio WhatsApp API
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');

    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && conversation.companies?.whatsapp_number) {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
      
      const formData = new URLSearchParams();
      // Normalize From number
      const fromNumber = conversation.companies.whatsapp_number.startsWith('whatsapp:') 
        ? conversation.companies.whatsapp_number 
        : `whatsapp:${conversation.companies.whatsapp_number}`;
      formData.append('From', fromNumber);

      // Normalize To number — ensure whatsapp: prefix
      const toNumber = normalizeWhatsAppTo(conversation.phone);
      formData.append('To', toNumber);
      
      formData.append('Body', message || '');
      
      if (effectiveMediaUrl) {
        console.log('Adding MediaUrl to Twilio request:', effectiveMediaUrl);
        formData.append('MediaUrl', effectiveMediaUrl);
      }

      console.log(`[send-whatsapp-message] Sending: From=${fromNumber} To=${toNumber}`);

      try {
        const twilioResponse = await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formData.toString(),
        });

        if (!twilioResponse.ok) {
          const errorText = await twilioResponse.text();
          console.error('Twilio API error:', twilioResponse.status, errorText);
        } else {
          console.log('Message sent via Twilio successfully');
        }
      } catch (twilioError) {
        console.error('Error sending message via Twilio:', twilioError);
      }
    } else {
      console.warn('[send-whatsapp-message] Missing Twilio creds or whatsapp_number, skipping Twilio send');
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("Error in send-whatsapp-message:", error);
    return new Response(
      JSON.stringify({ error: 'An error occurred processing your request' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
