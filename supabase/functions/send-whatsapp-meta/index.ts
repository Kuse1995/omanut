import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SendMessageRequest {
  to: string;
  message?: string;
  templateName?: string;
  templateParams?: string[];
  mediaUrl?: string;
  mediaType?: 'image' | 'document' | 'audio' | 'video';
  companyId?: string;
  conversationId?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: SendMessageRequest = await req.json();
    const { to, message, templateName, templateParams, mediaUrl, mediaType, companyId, conversationId } = body;

    console.log('[META-SEND] Request received:', { to, hasMessage: !!message, templateName, hasMedia: !!mediaUrl });

    // Get Meta credentials - try company-specific first, then fall back to global
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    let phoneNumberId = Deno.env.get('META_PHONE_NUMBER_ID');
    let accessToken = Deno.env.get('META_WHATSAPP_ACCESS_TOKEN');

    // If companyId provided, try to get company-specific config
    if (companyId) {
      const { data: company } = await supabase
        .from('companies')
        .select('meta_phone_number_id, metadata')
        .eq('id', companyId)
        .single();

      if (company?.meta_phone_number_id) {
        phoneNumberId = company.meta_phone_number_id;
        console.log('[META-SEND] Using company-specific phone number ID');
      }
    }

    if (!phoneNumberId || !accessToken) {
      console.error('[META-SEND] Missing Meta credentials');
      return new Response(
        JSON.stringify({ error: 'Meta WhatsApp credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Format phone number (remove any non-numeric chars except +)
    const formattedPhone = to.replace(/[^\d]/g, '');
    
    // Build the message payload
    let messagePayload: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formattedPhone,
    };

    if (templateName) {
      // Template message (for initiating conversations or after 24-hour window)
      messagePayload.type = 'template';
      messagePayload.template = {
        name: templateName,
        language: { code: 'en' },
      };
      
      if (templateParams && templateParams.length > 0) {
        messagePayload.template.components = [
          {
            type: 'body',
            parameters: templateParams.map(text => ({ type: 'text', text }))
          }
        ];
      }
    } else if (mediaUrl) {
      // Media message
      const type = mediaType || 'image';
      messagePayload.type = type;
      messagePayload[type] = {
        link: mediaUrl,
      };
      
      // Add caption for images
      if (message && (type === 'image' || type === 'video')) {
        messagePayload[type].caption = message;
      }
    } else if (message) {
      // Text message
      messagePayload.type = 'text';
      messagePayload.text = {
        preview_url: true,
        body: message
      };
    } else {
      return new Response(
        JSON.stringify({ error: 'No message content provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[META-SEND] Sending to Meta API:', JSON.stringify(messagePayload, null, 2));

    // Send message via Meta Graph API
    const metaResponse = await fetch(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messagePayload),
      }
    );

    const metaResult = await metaResponse.json();
    console.log('[META-SEND] Meta API response:', JSON.stringify(metaResult));

    if (!metaResponse.ok) {
      console.error('[META-SEND] Meta API error:', metaResult);
      
      // Store failed message
      await supabase.from('whatsapp_messages').insert({
        company_id: companyId,
        conversation_id: conversationId,
        customer_phone: formattedPhone,
        direction: 'outbound',
        content: message || `[Template: ${templateName}]`,
        message_type: templateName ? 'template' : (mediaUrl ? mediaType : 'text'),
        media_url: mediaUrl,
        status: 'failed',
        error_code: metaResult.error?.code?.toString(),
        error_message: metaResult.error?.message,
        metadata: { payload: messagePayload, error: metaResult }
      });

      return new Response(
        JSON.stringify({ error: 'Failed to send message', details: metaResult }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const messageId = metaResult.messages?.[0]?.id;

    // Store successful message
    await supabase.from('whatsapp_messages').insert({
      company_id: companyId,
      conversation_id: conversationId,
      whatsapp_message_id: messageId,
      customer_phone: formattedPhone,
      direction: 'outbound',
      content: message || `[Template: ${templateName}]`,
      message_type: templateName ? 'template' : (mediaUrl ? mediaType : 'text'),
      media_url: mediaUrl,
      status: 'sent',
      metadata: { wamid: messageId }
    });

    // Also store in messages table for conversation history
    if (conversationId && message) {
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: message,
        message_metadata: { whatsapp_message_id: messageId, channel: 'whatsapp_meta' }
      });
    }

    console.log('[META-SEND] Message sent successfully:', messageId);

    return new Response(
      JSON.stringify({ 
        success: true, 
        messageId,
        status: 'sent'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('[META-SEND] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
