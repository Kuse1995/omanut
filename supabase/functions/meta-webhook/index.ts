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

      // Return 200 immediately so Meta doesn't time out
      const backgroundTask = processWebhook(body);

      // Use waitUntil if available (Deno Deploy / Supabase Edge Runtime)
      if (typeof (globalThis as any).EdgeRuntime !== 'undefined') {
        (globalThis as any).EdgeRuntime.waitUntil(backgroundTask);
      } else {
        // Fallback: just fire-and-forget
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

    if (!entry.changes) continue;

    for (const change of entry.changes) {
      // Only handle new comments on feed
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

      // Don't reply to our own comments (page replying to itself)
      if (commenterFbId === pageId) {
        console.log('Skipping own comment from page');
        continue;
      }

      console.log(`Processing comment ${commentId}: "${messageText}" from ${commenterName}`);

      try {
        await handleComment(supabase, pageId, commentId, messageText, commenterName);
      } catch (err) {
        console.error(`Error handling comment ${commentId}:`, err);
      }
    }
  }
}

async function handleComment(
  supabase: any,
  pageId: string,
  commentId: string,
  messageText: string,
  commenterName: string,
  commenterFbId: string,
) {
  // 1. Look up credentials for this page
  const { data: cred, error: credError } = await supabase
    .from('meta_credentials')
    .select('access_token, ai_system_prompt')
    .eq('page_id', pageId)
    .limit(1)
    .maybeSingle();

  if (credError) {
    console.error('Error fetching meta_credentials:', credError);
    return;
  }

  if (!cred) {
    console.warn(`No meta_credentials found for page_id: ${pageId}`);
    return;
  }

  const { access_token, ai_system_prompt } = cred;

  // 2. Generate AI reply via Lovable AI Gateway
  const aiReply = await generateAIReply(messageText, commenterName, ai_system_prompt || '');
  if (!aiReply) {
    console.error('AI returned empty reply, skipping');
    return;
  }

  console.log(`AI reply for ${commentId}: "${aiReply.slice(0, 100)}..."`);

  // 3. Wait 15 seconds to appear more human and avoid Meta bot filters
  console.log(`Waiting 15 seconds before posting reply to ${commentId}...`);
  await new Promise(resolve => setTimeout(resolve, 15000));

  // 4. Post reply to Facebook Graph API
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
}

async function generateAIReply(
  userMessage: string,
  commenterName: string,
  systemPrompt: string,
): Promise<string | null> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    console.error('LOVABLE_API_KEY not configured');
    return null;
  }

  const defaultSystemPrompt = `You are a helpful social media assistant replying to Facebook comments on behalf of a business page. Keep replies friendly, concise, and professional. Do not use hashtags unless relevant.`;

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
        {
          role: 'user',
          content: `A user named "${commenterName}" commented on our Facebook post:\n\n"${userMessage}"\n\nWrite a short, helpful reply.`,
        },
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
