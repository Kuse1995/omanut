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
      console.log('Webhook received:', JSON.stringify(body).slice(0, 500));

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

      // Handle feed comments
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field !== 'feed') continue;
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
        }
      }

      // Handle Messenger DMs
      if (entry.messaging) {
        for (const event of entry.messaging) {
          if (!event.message?.text) continue;
          if (event.message?.is_echo) continue;

          const senderId = event.sender?.id;
          const messageText = event.message.text;
          if (!senderId || !messageText) continue;
          if (senderId === pageId) continue;

          console.log(`Processing Messenger DM from ${senderId}: "${messageText.slice(0, 80)}"`);
          try {
            await handleMessengerDM(supabase, pageId, senderId, messageText);
          } catch (err) {
            console.error(`Error handling Messenger DM from ${senderId}:`, err);
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
    console.warn(`No meta_credentials found for ig_user_id: ${igUserId}`);
    return null;
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

  parts.push(`You are a helpful AI assistant replying to ${contextLabel} on behalf of a business. Keep replies friendly, concise, and professional.`);

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
    parts.push('Do not use hashtags unless relevant. Keep replies public-appropriate and concise.');
  }

  return parts.join('\n\n');
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

  const aiReply = await generateAIReply(messageText, 'Customer', systemPrompt, 'messenger');
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

  const aiReply = await generateAIReply(messageText, 'Customer', systemPrompt, 'instagram_dm');
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

// ── AI Reply Generation ──
async function generateAIReply(
  userMessage: string,
  commenterName: string,
  systemPrompt: string,
  context: 'comment' | 'messenger' | 'instagram_comment' | 'instagram_dm',
): Promise<string | null> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    console.error('LOVABLE_API_KEY not configured');
    return null;
  }

  const contextPrompts: Record<string, string> = {
    comment: `A user named "${commenterName}" commented on our Facebook post:\n\n"${userMessage}"\n\nWrite a short, helpful reply.`,
    messenger: `A customer sent a direct message on Facebook Messenger:\n\n"${userMessage}"\n\nWrite a short, helpful reply.`,
    instagram_comment: `A user named "${commenterName}" commented on our Instagram post:\n\n"${userMessage}"\n\nWrite a short, helpful reply.`,
    instagram_dm: `A customer sent a direct message on Instagram:\n\n"${userMessage}"\n\nWrite a short, helpful reply.`,
  };

  const userPrompt = contextPrompts[context] || contextPrompts.comment;

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-3-flash-preview',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 300,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`AI Gateway error (${response.status}):`, errText);
    return null;
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}
