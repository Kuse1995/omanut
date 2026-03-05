import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { conversationId, message, mediaUrl } = await req.json();

    if (!conversationId || (!message && !mediaUrl)) {
      return new Response(
        JSON.stringify({ error: 'conversationId and either message or mediaUrl are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get conversation details
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('*, companies(twilio_number, whatsapp_number)')
      .eq('id', conversationId)
      .single();

    if (convError || !conversation) {
      console.error('Error fetching conversation:', convError);
      return new Response(
        JSON.stringify({ error: 'Conversation not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user belongs to this company
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    
    if (claimsError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = claimsData.claims.sub;

    // Check multi-tenant access via company_users
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

    // Insert message into database
    const { error: msgError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: message || (mediaUrl ? 'Sent an attachment' : '')
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
      // Ensure whatsapp: prefix is not duplicated
      const fromNumber = conversation.companies.whatsapp_number.startsWith('whatsapp:') 
        ? conversation.companies.whatsapp_number 
        : `whatsapp:${conversation.companies.whatsapp_number}`;
      formData.append('From', fromNumber);
      formData.append('To', conversation.phone);
      
      // Twilio requires Body field even with media
      formData.append('Body', message || '');
      
      // Add media URL if provided
      if (mediaUrl) {
        console.log('Adding MediaUrl to Twilio request:', mediaUrl);
        formData.append('MediaUrl', mediaUrl);
      }

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
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("Error in send-whatsapp-message:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
