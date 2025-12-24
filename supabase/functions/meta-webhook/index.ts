import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // Handle Facebook/WhatsApp verification handshake (GET request)
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    console.log('[META-WEBHOOK] Verification request:', { mode, hasToken: !!token, hasChallenge: !!challenge });

    const verifyToken = Deno.env.get('META_VERIFY_TOKEN');

    if (mode === 'subscribe' && token === verifyToken) {
      console.log('[META-WEBHOOK] Verification successful');
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    } else {
      console.error('[META-WEBHOOK] Verification failed');
      return new Response('Forbidden', {
        status: 403,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  }

  // Handle incoming webhook events (POST request)
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      console.log('[META-WEBHOOK] Event received:', JSON.stringify(body, null, 2));

      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );

      // Handle WhatsApp Business Account events
      if (body.object === 'whatsapp_business_account') {
        for (const entry of body.entry || []) {
          const changes = entry.changes || [];
          
          for (const change of changes) {
            if (change.field === 'messages') {
              const value = change.value;
              const phoneNumberId = value.metadata?.phone_number_id;
              const displayPhoneNumber = value.metadata?.display_phone_number;
              
              console.log('[META-WEBHOOK] WhatsApp message from phone:', phoneNumberId);

              // Find company by meta_phone_number_id
              const { data: company } = await supabase
                .from('companies')
                .select('*')
                .eq('meta_phone_number_id', phoneNumberId)
                .single();

              // Handle incoming messages
              for (const message of value.messages || []) {
                const customerPhone = message.from;
                const messageId = message.id;
                const timestamp = message.timestamp;
                const messageType = message.type;

                console.log('[META-WEBHOOK] Processing message:', { customerPhone, messageId, messageType });

                // Extract message content based on type
                let content = '';
                let mediaUrl = '';
                let mediaType = '';

                switch (messageType) {
                  case 'text':
                    content = message.text?.body || '';
                    break;
                  case 'image':
                    content = message.image?.caption || '[Image received]';
                    mediaUrl = message.image?.id; // Media ID - needs to be downloaded separately
                    mediaType = 'image';
                    break;
                  case 'document':
                    content = message.document?.caption || `[Document: ${message.document?.filename || 'file'}]`;
                    mediaUrl = message.document?.id;
                    mediaType = 'document';
                    break;
                  case 'audio':
                    content = '[Audio message received]';
                    mediaUrl = message.audio?.id;
                    mediaType = 'audio';
                    break;
                  case 'video':
                    content = message.video?.caption || '[Video received]';
                    mediaUrl = message.video?.id;
                    mediaType = 'video';
                    break;
                  case 'location':
                    content = `[Location: ${message.location?.latitude}, ${message.location?.longitude}]`;
                    break;
                  case 'contacts':
                    content = `[Contact shared: ${message.contacts?.[0]?.name?.formatted_name || 'Unknown'}]`;
                    break;
                  case 'button':
                    content = message.button?.text || '[Button clicked]';
                    break;
                  case 'interactive':
                    content = message.interactive?.button_reply?.title || 
                              message.interactive?.list_reply?.title || 
                              '[Interactive response]';
                    break;
                  default:
                    content = `[${messageType} message]`;
                }

                // Get customer name from contacts if available
                const customerName = value.contacts?.[0]?.profile?.name || null;

                // Find or create conversation
                let conversationId: string | null = null;
                
                if (company) {
                  // Look for existing active conversation
                  const { data: existingConv } = await supabase
                    .from('conversations')
                    .select('id')
                    .eq('company_id', company.id)
                    .eq('phone', customerPhone)
                    .eq('status', 'active')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .single();

                  if (existingConv) {
                    conversationId = existingConv.id;
                    
                    // Update conversation with latest message
                    await supabase
                      .from('conversations')
                      .update({
                        last_message_preview: content.substring(0, 100),
                        customer_name: customerName || undefined,
                        unread_count: 1
                      })
                      .eq('id', conversationId);
                  } else {
                    // Create new conversation
                    const { data: newConv, error: convError } = await supabase
                      .from('conversations')
                      .insert({
                        company_id: company.id,
                        phone: customerPhone,
                        customer_name: customerName,
                        status: 'active',
                        last_message_preview: content.substring(0, 100),
                        unread_count: 1
                      })
                      .select('id')
                      .single();

                    if (newConv) {
                      conversationId = newConv.id;
                      console.log('[META-WEBHOOK] Created new conversation:', conversationId);
                    } else {
                      console.error('[META-WEBHOOK] Failed to create conversation:', convError);
                    }
                  }
                }

                // Store in whatsapp_messages table
                const { error: insertError } = await supabase
                  .from('whatsapp_messages')
                  .insert({
                    company_id: company?.id,
                    conversation_id: conversationId,
                    whatsapp_message_id: messageId,
                    customer_phone: customerPhone,
                    customer_name: customerName,
                    message_type: messageType,
                    direction: 'inbound',
                    content: content,
                    media_url: mediaUrl || null,
                    media_type: mediaType || null,
                    status: 'received',
                    metadata: { 
                      timestamp,
                      phone_number_id: phoneNumberId,
                      display_phone_number: displayPhoneNumber,
                      original: message
                    }
                  });

                if (insertError) {
                  console.error('[META-WEBHOOK] DB insert error:', insertError);
                } else {
                  console.log('[META-WEBHOOK] Message stored successfully');
                }

                // Store in messages table for conversation history
                if (conversationId) {
                  await supabase.from('messages').insert({
                    conversation_id: conversationId,
                    role: 'user',
                    content: content,
                    message_metadata: { 
                      whatsapp_message_id: messageId, 
                      channel: 'whatsapp_meta',
                      media_type: mediaType || null
                    }
                  });
                }

                // Trigger AI response if company found and not in human takeover
                if (company && conversationId) {
                  const { data: conv } = await supabase
                    .from('conversations')
                    .select('human_takeover, is_paused_for_human')
                    .eq('id', conversationId)
                    .single();

                  if (!conv?.human_takeover && !conv?.is_paused_for_human) {
                    // Trigger AI response via the whatsapp-ai-response function
                    console.log('[META-WEBHOOK] Triggering AI response for conversation:', conversationId);
                    
                    try {
                      const aiResponse = await fetch(
                        `${Deno.env.get('SUPABASE_URL')}/functions/v1/whatsapp-ai-response`,
                        {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
                          },
                          body: JSON.stringify({
                            conversationId,
                            companyId: company.id,
                            customerPhone,
                            customerName,
                            message: content,
                            messageType
                          })
                        }
                      );
                      
                      if (!aiResponse.ok) {
                        console.error('[META-WEBHOOK] AI response function error:', await aiResponse.text());
                      }
                    } catch (aiError) {
                      console.error('[META-WEBHOOK] Failed to trigger AI response:', aiError);
                    }
                  } else {
                    console.log('[META-WEBHOOK] Conversation in human takeover, skipping AI');
                  }
                }
              }

              // Handle message status updates
              for (const status of value.statuses || []) {
                const messageId = status.id;
                const statusValue = status.status; // sent, delivered, read, failed
                const recipientId = status.recipient_id;
                const timestamp = status.timestamp;

                console.log('[META-WEBHOOK] Status update:', { messageId, status: statusValue });

                // Update whatsapp_messages status
                const { error: updateError } = await supabase
                  .from('whatsapp_messages')
                  .update({
                    status: statusValue,
                    updated_at: new Date().toISOString()
                  })
                  .eq('whatsapp_message_id', messageId);

                if (updateError) {
                  console.error('[META-WEBHOOK] Status update error:', updateError);
                }
              }
            }
          }
        }
      }

      // Handle Facebook Messenger events (legacy support)
      if (body.object === 'page' && body.entry) {
        for (const entry of body.entry) {
          const pageId = entry.id;
          const messaging = entry.messaging || [];

          for (const event of messaging) {
            const senderPsid = event.sender?.id;
            const messageText = event.message?.text;

            if (senderPsid && messageText) {
              console.log(`[META-WEBHOOK] Messenger message from ${senderPsid}: ${messageText}`);
              
              await supabase
                .from('facebook_messages')
                .insert({
                  sender_psid: senderPsid,
                  page_id: pageId,
                  message_text: messageText,
                  is_processed: false
                });
            }
          }
        }
      }

    } catch (parseError) {
      console.error('[META-WEBHOOK] Error processing webhook:', parseError);
    }

    // Always return 200 OK to Meta
    return new Response('EVENT_RECEIVED', {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
    });
  }

  return new Response('Method not allowed', {
    status: 405,
    headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
  });
});
