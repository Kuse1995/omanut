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

  if (body.object !== 'page' || !body.entry) {
    console.log('Not a page event, ignoring');
    return;
  }

  for (const entry of body.entry) {
    const pageId = entry.id;

    // ── Handle feed comments ──
    if (entry.changes) {
      for (const change of entry.changes) {
        if (change.field !== 'feed') continue;

        const value = change.value;
        if (!value || value.item !== 'comment' || value.verb !== 'add') continue;

        const commentId = value.comment_id;
        const messageText = value.message;
        const commenterName = value.from?.name || 'User';
        const commenterFbId = value.from?.id;

        if (!commentId || !messageText) {
          console.log('Missing comment_id or message, skipping');
          continue;
        }

        if (commenterFbId === pageId) {
          console.log('Skipping own comment from page');
          continue;
        }

        console.log(`Processing comment ${commentId}: "${messageText}" from ${commenterName}`);

        try {
          await handleComment(supabase, pageId, commentId, messageText, commenterName, commenterFbId);
        } catch (err) {
          console.error(`Error handling comment ${commentId}:`, err);
        }
      }
    }

    // ── Handle Messenger DMs ──
    if (entry.messaging) {
      for (const event of entry.messaging) {
        // Skip non-text events (read receipts, deliveries, etc.)
        if (!event.message?.text) continue;
        // Skip echo messages (our own outgoing messages)
        if (event.message?.is_echo) continue;

        const senderId = event.sender?.id;
        const messageText = event.message.text;

        if (!senderId || !messageText) continue;

        // Don't reply to ourselves
        if (senderId === pageId) {
          console.log('Skipping own message from page');
          continue;
        }

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

// ── Get page credentials (includes company_id) ──
async function getPageCredentials(supabase: any, pageId: string) {
  const { data: cred, error } = await supabase
    .from('meta_credentials')
    .select('access_token, ai_system_prompt, company_id')
    .eq('page_id', pageId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error fetching meta_credentials:', error);
    return null;
  }
  if (!cred) {
    console.warn(`No meta_credentials found for page_id: ${pageId}`);
    return null;
  }
  return cred;
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

  const aiReply = await generateAIReply(messageText, commenterName, ai_system_prompt || '', 'comment');
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

  // Save to DB
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

  const aiReply = await generateAIReply(messageText, 'Customer', ai_system_prompt || '', 'messenger');
  if (!aiReply) {
    console.error('AI returned empty reply for Messenger DM, skipping');
    return;
  }

  console.log(`Messenger AI reply for ${senderId}: "${aiReply.slice(0, 100)}..."`);

  // No delay for DMs — Messenger expects fast replies
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

  // Save to DB
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

// ── AI Reply Generation ──
async function generateAIReply(
  userMessage: string,
  commenterName: string,
  systemPrompt: string,
  context: 'comment' | 'messenger',
): Promise<string | null> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    console.error('LOVABLE_API_KEY not configured');
    return null;
  }

  const defaultSystemPrompt = context === 'messenger'
    ? `You are a helpful customer service assistant replying to Facebook Messenger direct messages on behalf of a business. Keep replies friendly, concise, and professional.`
    : `You are a helpful social media assistant replying to Facebook comments on behalf of a business page. Keep replies friendly, concise, and professional. Do not use hashtags unless relevant.`;

  const userPrompt = context === 'messenger'
    ? `A customer sent a direct message on Facebook Messenger:\n\n"${userMessage}"\n\nWrite a short, helpful reply.`
    : `A user named "${commenterName}" commented on our Facebook post:\n\n"${userMessage}"\n\nWrite a short, helpful reply.`;

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-3-flash-preview',
      messages: [
        { role: 'system', content: systemPrompt || defaultSystemPrompt },
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
