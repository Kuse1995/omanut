import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { geminiChat } from "../_shared/gemini-client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // ── GET: Meta verification handshake ──
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    const verifyToken = Deno.env.get('META_VERIFY_TOKEN');

    if (mode === 'subscribe' && token === verifyToken) {
      console.log('Verification successful');
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
    return new Response('Forbidden', { status: 403 });
  }

  // ── POST: Incoming webhook events ──
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      console.log('Webhook received:', JSON.stringify(body).slice(0, 800));
      console.log(`[meta-webhook] object=${body.object}, entries=${body.entry?.length || 0}, entry_ids=${(body.entry || []).map((e: any) => e.id).join(',')}`);

      const backgroundTask = processWebhook(body);

      if (typeof (globalThis as any).EdgeRuntime !== 'undefined') {
        (globalThis as any).EdgeRuntime.waitUntil(backgroundTask);
      } else {
        backgroundTask.catch(err => console.error('Background task error:', err));
      }

      return new Response(JSON.stringify({ status: 'received' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Error parsing webhook:', error);
      return new Response(JSON.stringify({ status: 'error' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response('Method not allowed', { status: 405 });
});

// ── Background processing ──
async function processWebhook(body: any) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const objectType = body.object;

  if (!body.entry) {
    console.log('No entry array, ignoring');
    return;
  }

  if (objectType === 'page') {
    // ── Facebook Page events (comments + Messenger DMs) ──
    for (const entry of body.entry) {
      const pageId = entry.id;
      const hasMessagingArray = Array.isArray(entry.messaging) && entry.messaging.length > 0;

      // Pre-fetch page credentials to check if this page has an IG account linked
      const pageCred = await getPageCredentials(supabase, pageId);
      const linkedIgUserId = pageCred?.ig_user_id;

      // Handle feed comments + fallback message events delivered via changes[]
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field === 'feed') {
            const value = change.value;
            if (!value || value.item !== 'comment' || value.verb !== 'add') continue;

            const commentId = value.comment_id;
            const messageText = value.message;
            const commenterName = value.from?.name || 'User';
            const commenterFbId = value.from?.id;

            if (!commentId || !messageText) continue;
            if (commenterFbId === pageId) {
              console.log('Skipping own comment from page');
              continue;
            }

            console.log(`Processing FB comment ${commentId}: "${messageText}" from ${commenterName}`);
            try {
              await handleComment(supabase, pageId, commentId, messageText, commenterName, commenterFbId);
            } catch (err) {
              console.error(`Error handling comment ${commentId}:`, err);
            }
            continue;
          }

          // Some Meta deliveries put messaging events under changes[].value instead of entry.messaging
          if (!hasMessagingArray && change.field === 'messages') {
            const value = change.value;
            const messageEvents = Array.isArray(value?.messaging)
              ? value.messaging
              : (value?.sender && value?.recipient && value?.message ? [value] : []);

            for (const event of messageEvents) {
              if (!event.message?.text || event.message?.is_echo) continue;
              const senderId = event.sender?.id;
              const messageText = event.message.text;
              if (!senderId || !messageText || senderId === pageId) continue;

              const recipientId = event.recipient?.id;
              const isInstagramDM = !!linkedIgUserId && String(recipientId) === String(linkedIgUserId);

              try {
                if (isInstagramDM) {
                  await handleInstagramDM(supabase, String(linkedIgUserId), senderId, messageText);
                } else {
                  await handleMessengerDM(supabase, pageId, senderId, messageText);
                }
              } catch (err) {
                console.error('Error handling message event from changes[]:', err);
              }
            }
          }
        }
      }

      // Handle Messenger DMs (may also include Instagram DMs via unified Page subscription)
      if (entry.messaging) {
        // Pre-fetch page credentials to check if this page has an IG account linked
        const pageCred = await getPageCredentials(supabase, pageId);
        const linkedIgUserId = pageCred?.ig_user_id;

        for (const event of entry.messaging) {
          if (!event.message?.text) continue;
          if (event.message?.is_echo) continue;

          const senderId = event.sender?.id;
          const messageText = event.message.text;
          if (!senderId || !messageText) continue;
          if (senderId === pageId) continue;

          // Detect if this is an Instagram-scoped DM arriving through the Page webhook.
          // Instagram DMs via the Page subscription have the sender ID matching an IG-scoped user.
          // We check: does the page have an ig_user_id, and does the recipient differ from the page ID
          // (Instagram messages use the ig_user_id as recipient, not the page_id).
          const recipientId = event.recipient?.id;
          const isInstagramDM = !!linkedIgUserId && String(recipientId) === String(linkedIgUserId);

          if (isInstagramDM) {
            console.log(`[meta-webhook] Detected Instagram DM (via page webhook) from ${senderId}: "${messageText.slice(0, 80)}"`);
            try {
              await handleInstagramDM(supabase, linkedIgUserId, senderId, messageText);
            } catch (err) {
              console.error(`Error handling IG DM (via page) from ${senderId}:`, err);
            }
          } else {
            console.log(`Processing Messenger DM from ${senderId}: "${messageText.slice(0, 80)}"`);
            try {
              await handleMessengerDM(supabase, pageId, senderId, messageText);
            } catch (err) {
              console.error(`Error handling Messenger DM from ${senderId}:`, err);
            }
          }
        }
      }
    }
  } else if (objectType === 'instagram') {
    // ── Instagram events (comments + DMs) ──
    for (const entry of body.entry) {
      const igUserId = entry.id;

      // Handle Instagram comments
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field !== 'comments') continue;
          const value = change.value;
          if (!value) continue;

          const commentId = value.id;
          const messageText = value.text;
          const commenterName = value.from?.username || 'Instagram User';
          const commenterIgId = value.from?.id;
          const mediaId = value.media?.id;

          if (!commentId || !messageText) continue;
          // Skip own comments
          if (commenterIgId === igUserId) {
            console.log('Skipping own Instagram comment');
            continue;
          }

          console.log(`Processing IG comment ${commentId}: "${messageText}" from ${commenterName}`);
          try {
            await handleInstagramComment(supabase, igUserId, commentId, messageText, commenterName, commenterIgId, mediaId);
          } catch (err) {
            console.error(`Error handling IG comment ${commentId}:`, err);
          }
        }
      }

      // Handle Instagram DMs
      if (entry.messaging) {
        for (const event of entry.messaging) {
          if (!event.message?.text) continue;
          if (event.message?.is_echo) continue;

          const senderId = event.sender?.id;
          const messageText = event.message.text;
          if (!senderId || !messageText) continue;
          if (senderId === igUserId) continue;

          console.log(`Processing IG DM from ${senderId}: "${messageText.slice(0, 80)}"`);
          try {
            await handleInstagramDM(supabase, igUserId, senderId, messageText);
          } catch (err) {
            console.error(`Error handling IG DM from ${senderId}:`, err);
          }
        }
      }
    }
  } else {
    console.log(`Unhandled object type: ${objectType}, ignoring`);
  }
}

// ── Get page credentials by page_id ──
async function getPageCredentials(supabase: any, pageId: string) {
  const { data: cred, error } = await supabase
    .from('meta_credentials')
    .select('access_token, ai_system_prompt, company_id, ig_user_id')
    .eq('page_id', pageId)
    .not('company_id', 'is', null)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error fetching meta_credentials:', error);
    return null;
  }

  if (!cred) {
    const { data: fallback, error: fbErr } = await supabase
      .from('meta_credentials')
      .select('access_token, ai_system_prompt, company_id, ig_user_id')
      .eq('page_id', pageId)
      .limit(1)
      .maybeSingle();

    if (fbErr) {
      console.error('Error fetching fallback meta_credentials:', fbErr);
      return null;
    }
    if (!fallback) {
      console.warn(`No meta_credentials found for page_id: ${pageId}`);
      return null;
    }
    return fallback;
  }
  return cred;
}

// ── Get credentials by ig_user_id ──
async function getIgCredentials(supabase: any, igUserId: string) {
  const { data: cred, error } = await supabase
    .from('meta_credentials')
    .select('access_token, ai_system_prompt, company_id, page_id, ig_user_id')
    .eq('ig_user_id', igUserId)
    .not('company_id', 'is', null)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error fetching IG meta_credentials:', error);
    return null;
  }

  if (!cred) {
    // Fallback: try looking up by page_id in case ig_user_id was stored differently
    console.warn(`No meta_credentials found for ig_user_id: ${igUserId}, trying fallback by page_id...`);
    const { data: fallbackCred, error: fbErr } = await supabase
      .from('meta_credentials')
      .select('access_token, ai_system_prompt, company_id, page_id, ig_user_id')
      .eq('page_id', igUserId)
      .not('company_id', 'is', null)
      .limit(1)
      .maybeSingle();

    if (fbErr) {
      console.error('Error fetching IG fallback meta_credentials by page_id:', fbErr);
      return null;
    }
    if (!fallbackCred) {
      console.warn(`No meta_credentials found for ig_user_id OR page_id: ${igUserId}`);
      return null;
    }
    console.log(`[getIgCredentials] Found credentials via page_id fallback for ${igUserId}`);
    return fallbackCred;
  }
  return cred;
}

// ── Build composite system prompt from company config + knowledge base ──
async function buildCompanySystemPrompt(
  supabase: any,
  companyId: string,
  credentialPrompt: string | null,
  context: 'comment' | 'messenger' | 'instagram_comment' | 'instagram_dm',
): Promise<string> {
  const contextLabels: Record<string, string> = {
    comment: 'Facebook comments on posts',
    messenger: 'Facebook Messenger direct messages',
    instagram_comment: 'Instagram comments on posts',
    instagram_dm: 'Instagram direct messages',
  };
  const contextLabel = contextLabels[context] || context;

  const [companyResult, overridesResult, docsResult] = await Promise.all([
    supabase
      .from('companies')
      .select('name, business_type, services, quick_reference_info')
      .eq('id', companyId)
      .single(),
    supabase
      .from('company_ai_overrides')
      .select('system_instructions, qa_style, banned_topics')
      .eq('company_id', companyId)
      .maybeSingle(),
    supabase
      .from('company_documents')
      .select('filename, parsed_content')
      .eq('company_id', companyId)
      .not('parsed_content', 'is', null),
  ]);

  const company = companyResult.data;
  const overrides = overridesResult.data;
  const docs = docsResult.data || [];

  const parts: string[] = [];

  parts.push(`You ARE a customer service representative for this business.
You speak directly to the customer as the business — use "we" and "our".
Write exactly ONE natural reply. Never offer multiple options or alternatives.
Never use headers (###), bullet points, or numbered lists.
Never give tips or meta-commentary about how to respond.
Never say "Here are some options" or "Option 1/2/3".
Just reply naturally as if you are the person managing the business's ${contextLabel}.
Keep it friendly, concise, and professional.`);

  if (company) {
    const identity = [`Company: ${company.name}`];
    if (company.business_type) identity.push(`Business type: ${company.business_type}`);
    if (company.services) identity.push(`Services: ${company.services}`);
    parts.push(`=== COMPANY IDENTITY ===\n${identity.join('\n')}`);
  }

  if (overrides) {
    if (overrides.system_instructions?.trim()) {
      parts.push(`=== CORE INSTRUCTIONS ===\n${overrides.system_instructions}`);
    }
    if (overrides.qa_style?.trim()) {
      parts.push(`=== RESPONSE STYLE ===\n${overrides.qa_style}`);
    }
    if (overrides.banned_topics?.trim()) {
      parts.push(`=== RESTRICTED TOPICS (never discuss) ===\n${overrides.banned_topics}`);
    }
  }

  if (company?.quick_reference_info?.trim()) {
    parts.push(`=== KNOWLEDGE BASE ===\n${company.quick_reference_info}`);
  }

  if (docs.length > 0) {
    const docContent = docs
      .filter((d: any) => d.parsed_content?.trim())
      .map((d: any) => `--- ${d.filename} ---\n${d.parsed_content.slice(0, 2000)}`)
      .join('\n\n');
    if (docContent) {
      parts.push(`=== DOCUMENT LIBRARY ===\n${docContent}`);
    }
  }

  if (credentialPrompt?.trim()) {
    parts.push(`=== PAGE-SPECIFIC INSTRUCTIONS ===\n${credentialPrompt}`);
  }

  if (context === 'comment' || context === 'instagram_comment') {
    parts.push('Keep replies public-appropriate and concise. Do not use hashtags unless relevant. No bullet points or lists.');
  } else {
    parts.push('Be conversational and warm, like a real person chatting. Keep it natural — no formal structure.');
  }

  return parts.join('\n\n');
}

// ── Trigger boss lead alert (fire-and-forget) ──
async function triggerLeadAlert(
  companyId: string,
  conversationId: string | undefined,
  platform: string,
  customerName: string,
  messageText: string,
) {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    await fetch(`${supabaseUrl}/functions/v1/meta-lead-alert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        company_id: companyId,
        conversation_id: conversationId,
        platform,
        customer_name: customerName,
        message_text: messageText,
      }),
    });
    console.log(`[meta-webhook] Lead alert triggered for ${platform}`);
  } catch (err) {
    console.error('[meta-webhook] Failed to trigger lead alert:', err);
  }
}

// ── Upsert conversation & save messages ──
async function saveInteraction(
  supabase: any,
  companyId: string,
  phoneKey: string,
  platform: string,
  customerName: string,
  userMessage: string,
  aiReply: string,
  userMeta: Record<string, any>,
  replyMeta: Record<string, any>,
) {
  const { data: existingConv } = await supabase
    .from('conversations')
    .select('id, unread_count')
    .eq('company_id', companyId)
    .eq('phone', phoneKey)
    .limit(1)
    .maybeSingle();

  let conversationId: string;

  if (existingConv) {
    conversationId = existingConv.id;
    await supabase
      .from('conversations')
      .update({
        last_message_preview: aiReply.slice(0, 100),
        unread_count: (existingConv.unread_count || 0) + 1,
        status: 'active',
      })
      .eq('id', conversationId);
  } else {
    const { data: newConv } = await supabase
      .from('conversations')
      .insert({
        company_id: companyId,
        phone: phoneKey,
        customer_name: customerName,
        platform,
        status: 'active',
        last_message_preview: aiReply.slice(0, 100),
        unread_count: 1,
      })
      .select('id')
      .single();
    conversationId = newConv?.id;
  }

  if (conversationId) {
    await supabase.from('messages').insert([
      {
        conversation_id: conversationId,
        role: 'user',
        content: userMessage,
        message_metadata: userMeta,
      },
      {
        conversation_id: conversationId,
        role: 'assistant',
        content: aiReply,
        message_metadata: replyMeta,
      },
    ]);
    console.log(`Saved interaction to conversation ${conversationId} (${platform})`);
  }

  // Fire-and-forget: trigger boss lead alert
  triggerLeadAlert(companyId, conversationId, platform, customerName, userMessage);
}

// ── Handle Facebook comment ──
async function handleComment(
  supabase: any,
  pageId: string,
  commentId: string,
  messageText: string,
  commenterName: string,
  commenterFbId: string,
) {
  const cred = await getPageCredentials(supabase, pageId);
  if (!cred) return;

  const { access_token, ai_system_prompt, company_id: companyId } = cred;

  const systemPrompt = companyId
    ? await buildCompanySystemPrompt(supabase, companyId, ai_system_prompt, 'comment')
    : ai_system_prompt || '';

  const aiReply = await generateAIReply(messageText, commenterName, systemPrompt, 'comment');
  if (!aiReply) {
    console.error('AI returned empty reply, skipping');
    return;
  }

  console.log(`AI reply for ${commentId}: "${aiReply.slice(0, 100)}..."`);

  // Wait 15 seconds to appear more human
  console.log(`Waiting 15 seconds before posting reply to ${commentId}...`);
  await new Promise(resolve => setTimeout(resolve, 15000));

  const fbResponse = await fetch(
    `https://graph.facebook.com/v25.0/${commentId}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: aiReply }),
    },
  );

  if (!fbResponse.ok) {
    const errorData = await fbResponse.text();
    console.error(`Facebook API error (${fbResponse.status}):`, errorData);
    return;
  }

  const result = await fbResponse.json();
  console.log(`Reply posted successfully! Reply ID: ${result.id}`);

  try {
    if (companyId) {
      await saveInteraction(
        supabase,
        companyId,
        `fb:${commenterFbId}`,
        'facebook',
        commenterName,
        messageText,
        aiReply,
        { source: 'facebook', comment_id: commentId },
        { source: 'facebook', reply_id: result.id },
      );
    }
  } catch (dbErr) {
    console.error('Error saving Facebook comment interaction to DB:', dbErr);
  }
}

// ── Handle Messenger DM ──
async function handleMessengerDM(
  supabase: any,
  pageId: string,
  senderId: string,
  messageText: string,
) {
  const cred = await getPageCredentials(supabase, pageId);
  if (!cred) return;

  const { access_token, ai_system_prompt, company_id: companyId } = cred;

  const systemPrompt = companyId
    ? await buildCompanySystemPrompt(supabase, companyId, ai_system_prompt, 'messenger')
    : ai_system_prompt || '';

  // Load conversation history for context
  const phoneKey = `fbdm:${senderId}`;
  const history = await loadConversationHistory(supabase, companyId, phoneKey);

  const aiReply = await generateAIReply(messageText, 'Customer', systemPrompt, 'messenger', history);
  if (!aiReply) {
    console.error('AI returned empty reply for Messenger DM, skipping');
    return;
  }

  console.log(`Messenger AI reply for ${senderId}: "${aiReply.slice(0, 100)}..."`);

  const messengerResponse = await fetch(
    `https://graph.facebook.com/v25.0/me/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: senderId },
        messaging_type: 'RESPONSE',
        message: { text: aiReply },
      }),
    },
  );

  if (!messengerResponse.ok) {
    const errorData = await messengerResponse.text();
    console.error(`Messenger API error (${messengerResponse.status}):`, errorData);
    return;
  }

  const result = await messengerResponse.json();
  console.log(`Messenger reply sent successfully! Message ID: ${result.message_id}`);

  try {
    if (companyId) {
      await saveInteraction(
        supabase,
        companyId,
        `fbdm:${senderId}`,
        'facebook_messenger',
        'Messenger User',
        messageText,
        aiReply,
        { source: 'facebook_messenger', sender_id: senderId },
        { source: 'facebook_messenger', message_id: result.message_id },
      );
    }
  } catch (dbErr) {
    console.error('Error saving Messenger DM interaction to DB:', dbErr);
  }
}

// ── Handle Instagram Comment ──
async function handleInstagramComment(
  supabase: any,
  igUserId: string,
  commentId: string,
  messageText: string,
  commenterName: string,
  commenterIgId: string,
  mediaId: string | undefined,
) {
  const cred = await getIgCredentials(supabase, igUserId);
  if (!cred) return;

  const { access_token, ai_system_prompt, company_id: companyId } = cred;

  const systemPrompt = companyId
    ? await buildCompanySystemPrompt(supabase, companyId, ai_system_prompt, 'instagram_comment')
    : ai_system_prompt || '';

  const aiReply = await generateAIReply(messageText, commenterName, systemPrompt, 'instagram_comment');
  if (!aiReply) {
    console.error('AI returned empty reply for IG comment, skipping');
    return;
  }

  console.log(`IG AI reply for ${commentId}: "${aiReply.slice(0, 100)}..."`);

  // Wait 15 seconds to appear more human
  console.log(`Waiting 15 seconds before posting IG reply to ${commentId}...`);
  await new Promise(resolve => setTimeout(resolve, 15000));

  const igResponse = await fetch(
    `https://graph.facebook.com/v25.0/${commentId}/replies`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: aiReply }),
    },
  );

  if (!igResponse.ok) {
    const errorData = await igResponse.text();
    console.error(`Instagram Comment API error (${igResponse.status}):`, errorData);
    return;
  }

  const result = await igResponse.json();
  console.log(`IG reply posted successfully! Reply ID: ${result.id}`);

  try {
    if (companyId) {
      await saveInteraction(
        supabase,
        companyId,
        `ig:${commenterIgId}`,
        'instagram',
        commenterName,
        messageText,
        aiReply,
        { source: 'instagram', comment_id: commentId, media_id: mediaId },
        { source: 'instagram', reply_id: result.id },
      );
    }
  } catch (dbErr) {
    console.error('Error saving IG comment interaction to DB:', dbErr);
  }
}

// ── Handle Instagram DM ──
async function handleInstagramDM(
  supabase: any,
  igUserId: string,
  senderId: string,
  messageText: string,
) {
  const cred = await getIgCredentials(supabase, igUserId);
  if (!cred) return;

  const { access_token, ai_system_prompt, company_id: companyId } = cred;

  const systemPrompt = companyId
    ? await buildCompanySystemPrompt(supabase, companyId, ai_system_prompt, 'instagram_dm')
    : ai_system_prompt || '';

  // Load conversation history for context
  const phoneKey = `igdm:${senderId}`;
  const history = await loadConversationHistory(supabase, companyId, phoneKey);

  const aiReply = await generateAIReply(messageText, 'Customer', systemPrompt, 'instagram_dm', history);
  if (!aiReply) {
    console.error('AI returned empty reply for IG DM, skipping');
    return;
  }

  console.log(`IG DM AI reply for ${senderId}: "${aiReply.slice(0, 100)}..."`);

  // Send reply via Instagram Messaging API
  const igResponse = await fetch(
    `https://graph.facebook.com/v25.0/me/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: senderId },
        message: { text: aiReply },
      }),
    },
  );

  if (!igResponse.ok) {
    const errorData = await igResponse.text();
    console.error(`Instagram DM API error (${igResponse.status}):`, errorData);
    return;
  }

  const result = await igResponse.json();
  console.log(`IG DM reply sent! Message ID: ${result.message_id}`);

  try {
    if (companyId) {
      await saveInteraction(
        supabase,
        companyId,
        `igdm:${senderId}`,
        'instagram_dm',
        'Instagram User',
        messageText,
        aiReply,
        { source: 'instagram_dm', sender_id: senderId },
        { source: 'instagram_dm', message_id: result.message_id },
      );
    }
  } catch (dbErr) {
    console.error('Error saving IG DM interaction to DB:', dbErr);
  }
}

// ── Load conversation history for DMs ──
async function loadConversationHistory(
  supabase: any,
  companyId: string | null,
  phoneKey: string,
): Promise<Array<{ role: string; content: string }>> {
  if (!companyId) return [];

  try {
    const { data: conv } = await supabase
      .from('conversations')
      .select('id')
      .eq('company_id', companyId)
      .eq('phone', phoneKey)
      .limit(1)
      .maybeSingle();

    if (!conv?.id) return [];

    const { data: messages } = await supabase
      .from('messages')
      .select('role, content')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: false })
      .limit(6);

    if (!messages || messages.length === 0) return [];

    // Reverse to chronological order
    return messages.reverse().map((m: any) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));
  } catch (err) {
    console.error('Error loading conversation history:', err);
    return [];
  }
}

// ── AI Reply Generation ──
async function generateAIReply(
  userMessage: string,
  commenterName: string,
  systemPrompt: string,
  context: 'comment' | 'messenger' | 'instagram_comment' | 'instagram_dm',
  conversationHistory: Array<{ role: string; content: string }> = [],
): Promise<string | null> {
  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
  if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY not configured');
    return null;
  }

  const contextPrompts: Record<string, string> = {
    comment: `"${commenterName}" commented on your post: "${userMessage}"\n\nReply to them now.`,
    messenger: `Customer says: "${userMessage}"\n\nReply to them now.`,
    instagram_comment: `"${commenterName}" commented on your post: "${userMessage}"\n\nReply to them now.`,
    instagram_dm: `Customer says: "${userMessage}"\n\nReply to them now.`,
  };

  const userPrompt = contextPrompts[context] || contextPrompts.comment;

  // Build messages array with optional conversation history
  const messages: Array<{ role: string; content: any }> = [
    { role: 'system', content: systemPrompt },
  ];

  // Prepend conversation history for DMs
  if (conversationHistory.length > 0) {
    messages.push({ role: 'system', content: '=== RECENT CONVERSATION HISTORY ===' });
    for (const msg of conversationHistory) {
      messages.push(msg);
    }
    messages.push({ role: 'system', content: '=== END HISTORY — Now respond to the latest message below ===' });
  }

  messages.push({ role: 'user', content: userPrompt });

  const response = await geminiChat({
    model: 'gemini-3-flash-preview',
    messages,
    max_tokens: 1024,
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`Gemini API error (${response.status}):`, errText);
    return null;
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}
