import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
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

    const { conversationId, text } = await req.json();

    if (!conversationId || !text) {
      return new Response(JSON.stringify({ error: 'conversationId and text are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load conversation
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, phone, company_id, customer_name')
      .eq('id', conversationId)
      .single();

    if (convError || !conversation) {
      console.error('[send-meta-dm] Conversation not found:', convError);
      return new Response(JSON.stringify({ error: 'Conversation not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const phone = conversation.phone || '';
    const isMessenger = phone.startsWith('fbdm:');
    const isInstagramDM = phone.startsWith('igdm:');

    if (!isMessenger && !isInstagramDM) {
      return new Response(JSON.stringify({ error: 'Not a Meta DM conversation' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const recipientId = phone.replace(/^(fbdm:|igdm:)/, '');
    const companyId = conversation.company_id;

    // Load Meta credentials for this company
    let cred;
    if (isInstagramDM) {
      // For IG DMs, look up by ig_user_id or company_id
      const { data } = await supabase
        .from('meta_credentials')
        .select('access_token, page_id, ig_user_id')
        .eq('company_id', companyId)
        .not('ig_user_id', 'is', null)
        .limit(1)
        .maybeSingle();
      cred = data;
    } else {
      // For Messenger, look up by company_id
      const { data } = await supabase
        .from('meta_credentials')
        .select('access_token, page_id, ig_user_id')
        .eq('company_id', companyId)
        .limit(1)
        .maybeSingle();
      cred = data;
    }

    if (!cred?.access_token) {
      console.error('[send-meta-dm] No Meta credentials for company:', companyId);
      return new Response(JSON.stringify({ error: 'Meta credentials not configured' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Send via Meta Graph API
    const graphUrl = 'https://graph.facebook.com/v25.0/me/messages';
    const graphResponse = await fetch(graphUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cred.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        messaging_type: 'RESPONSE',
        message: { text },
      }),
    });

    if (!graphResponse.ok) {
      const errorData = await graphResponse.text();
      console.error(`[send-meta-dm] Graph API error (${graphResponse.status}):`, errorData);
      return new Response(JSON.stringify({ error: `Meta API error: ${errorData}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = await graphResponse.json();
    console.log(`[send-meta-dm] Message sent! ID: ${result.message_id}`);

    // Save the outgoing message to the messages table
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      role: 'assistant',
      content: text,
      message_metadata: {
        source: isInstagramDM ? 'instagram_dm' : 'facebook_messenger',
        message_id: result.message_id,
        sent_by: 'human_agent',
      },
    });

    // Update conversation preview
    await supabase
      .from('conversations')
      .update({ last_message_preview: text.slice(0, 100) })
      .eq('id', conversationId);

    return new Response(JSON.stringify({ success: true, messageId: result.message_id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[send-meta-dm] Error:', error);
    return new Response(JSON.stringify({ error: 'An error occurred processing your request' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
