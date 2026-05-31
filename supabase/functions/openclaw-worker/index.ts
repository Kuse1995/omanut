// openclaw-worker — drains inbound_events, runs the AI, sends the reply via the
// right channel, and mirrors a notify_only copy to the customer tunnel.
//
// Triggers:
//   • pg_cron every minute (drains stragglers / retries)
//   • POST { event_id } from meta-webhook for immediate processing
//
// Channels handled here:
//   • direct_message  → Facebook Messenger or Instagram DM (Meta Graph)
//   • public_comment  → Facebook/Instagram comment public reply + best-effort
//     private reply to the commenter (Meta private-replies API)
//
// WhatsApp inbound continues to flow through `whatsapp-messages` as before;
// this worker only enqueues a mirror notify_only ping for WhatsApp events that
// were logged from whatsapp-messages (not invoked here).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { runSwarm } from '../_shared/swarm/overseer.ts';
import {
  classifyError,
  historyBudget,
  MAX_ATTEMPTS,
  nextAttemptAt,
  type NormalizedChannel,
} from '../_shared/channel.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH = 10;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Optional: explicit event_id from ingestion path for immediate processing.
  let explicitId: string | null = null;
  let bypassGrace = false;
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      explicitId = body?.event_id ?? null;
      bypassGrace = !!body?.bypass_grace;
    } catch { /* ignore */ }
  }

  // OpenClaw-v3: give external pull consumers (OpenClaw) first dibs. The
  // in-house worker only takes events whose age exceeds OPENCLAW_PULL_GRACE_SECONDS,
  // unless explicitly invoked with bypass_grace=true.
  const GRACE_SECONDS = Number(Deno.env.get('OPENCLAW_PULL_GRACE_SECONDS') ?? '8');
  const graceCutoff = new Date(Date.now() - GRACE_SECONDS * 1000).toISOString();

  const processed: string[] = [];

  try {
    let events: any[] = [];

    if (explicitId) {
      // Check grace window unless caller bypasses (cron straggler-runner does).
      const { data: row } = await supabase
        .from('inbound_events')
        .select('id, created_at, status')
        .eq('id', explicitId)
        .maybeSingle();
      if (!row) {
        // nothing to do
      } else if (row.status !== 'pending') {
        // Already claimed by OpenClaw or another consumer — nothing to do.
      } else if (!bypassGrace && row.created_at > graceCutoff) {
        // Still inside grace window. A scheduled invoke will retry after grace.
      } else {
        const { data } = await supabase
          .from('inbound_events')
          .update({
            status: 'processing',
            claimed_by: 'worker',
            claimed_at: new Date().toISOString(),
            picked_at: new Date().toISOString(),
          })
          .eq('id', explicitId)
          .eq('status', 'pending')
          .select('*');
        events = data ?? [];
      }
    } else {
      // Drain a batch of due pending events whose grace has elapsed.
      const { data: due } = await supabase
        .from('inbound_events')
        .select('id')
        .eq('status', 'pending')
        .lte('next_attempt_at', new Date().toISOString())
        .lte('created_at', graceCutoff)
        .order('next_attempt_at', { ascending: true })
        .limit(BATCH);

      if (due && due.length) {
        const ids = due.map((d: any) => d.id);
        const { data } = await supabase
          .from('inbound_events')
          .update({
            status: 'processing',
            claimed_by: 'worker',
            claimed_at: new Date().toISOString(),
            picked_at: new Date().toISOString(),
          })
          .in('id', ids)
          .eq('status', 'pending')
          .select('*');
        events = data ?? [];
      }
    }


    for (const ev of events) {
      const t0 = Date.now();
      try {
        await processOne(supabase, ev);
        processed.push(ev.id);
      } catch (e) {
        console.error('[openclaw-worker] processOne threw', ev.id, e);
        await failEvent(supabase, ev, null, String(e).slice(0, 500), 'unknown');
      } finally {
        const ms = Date.now() - t0;
        await supabase
          .from('inbound_events')
          .update({ latency_ms: ms })
          .eq('id', ev.id);
      }
    }
  } catch (e) {
    console.error('[openclaw-worker] fatal', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, processed: processed.length }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

// ---------------------------------------------------------------------------

async function processOne(supabase: any, ev: any) {
  const channel: NormalizedChannel = ev.channel;
  const source: string = ev.source;

  // OpenClaw-primary release: for any channel that OpenClaw owns, leave the
  // event pending so the laptop's pull loop can claim it. The in-house worker
  // only takes over once the grace window (OPENCLAW_PULL_GRACE_SECONDS) has
  // elapsed — see the SELECT in the main drain loop.
  const { data: companyCfg } = await supabase
    .from('companies')
    .select('openclaw_mode, openclaw_owns')
    .eq('id', ev.company_id)
    .maybeSingle();
  const primary = companyCfg?.openclaw_mode === 'primary';
  const ownsKey = channel === 'whatsapp'
    ? 'whatsapp'
    : channel === 'direct_message'
      ? 'meta_dm'
      : channel === 'public_comment'
        ? 'comments'
        : null;
  const owns = ownsKey ? companyCfg?.openclaw_owns?.[ownsKey] === true : false;

  if (primary && owns) {
    const ageMs = Date.now() - new Date(ev.created_at).getTime();
    if (ageMs < GRACE_SECONDS * 1000) {
      console.log('[openclaw-worker] releasing to OpenClaw pull', ev.id, channel);
      await supabase
        .from('inbound_events')
        .update({ status: 'pending', claimed_by: null, claimed_at: null, picked_at: null })
        .eq('id', ev.id);
      return;
    }
    console.log('[openclaw-worker] grace expired, falling back for', ev.id, channel);
  }

  // WhatsApp inbound is normally handled by whatsapp-messages — worker just mirrors
  // unless OpenClaw was primary and missed its grace window (then we fall through).
  if (channel === 'whatsapp') {
    await mirrorToTunnel(supabase, ev, ev.ai_response ?? null);
    await markSent(supabase, ev, ev.ai_response ?? '(handled by whatsapp-messages)', null, null);
    return;
  }

  // 1) Load company + fallback message
  const { data: company } = await supabase
    .from('companies')
    .select('id, name, business_type, voice_style, metadata, currency_prefix, payments_disabled, quick_reference_info')
    .eq('id', ev.company_id)
    .maybeSingle();
  if (!company) throw new Error('company_not_found');

  const { data: aiOverrides } = await supabase
    .from('company_ai_overrides')
    .select('fallback_message')
    .eq('company_id', ev.company_id)
    .maybeSingle();
  const fallbackMessage = aiOverrides?.fallback_message?.trim()
    || "Thanks for reaching out — our team will follow up shortly.";

  // 2) Build history
  const history = await loadHistory(supabase, ev, historyBudget(channel));
  const inboundText: string = ev.payload?.text || ev.payload?.message || '';

  if (!inboundText.trim()) {
    await markSkipped(supabase, ev, 'no_inbound_text');
    return;
  }

  // 3) Run swarm to generate the reply
  let aiText = '';
  let model = 'unknown';
  try {
    const swarm = await runSwarm(supabase, {
      company_id: ev.company_id,
      channel: channel === 'public_comment' ? 'meta_comment' : 'meta_dm',
      raw_text: inboundText,
      conversation_id: ev.conversation_id ?? undefined,
      history,
    });
    aiText = (swarm.final_text || '').trim();
    model = swarm.models_used?.creative || swarm.models_used?.gatekeeper || 'swarm';
  } catch (e) {
    console.warn('[openclaw-worker] swarm error', ev.id, e);
  }

  // 4) Empty-AI guard
  if (!aiText) {
    aiText = fallbackMessage;
    await logAiError(supabase, ev, 'empty_ai', 'swarm returned empty — used fallback_message');
  }

  // 5) Route to sender
  try {
    if (channel === 'direct_message') {
      await sendDirectMessage(supabase, ev, aiText);
    } else if (channel === 'public_comment') {
      await sendPublicComment(supabase, ev, aiText);
      // Best-effort private reply to commenter — never fails the event
      sendPrivateReplyToCommenter(supabase, ev, aiText).catch((e) =>
        console.warn('[openclaw-worker] private-reply failed', ev.id, String(e).slice(0, 200)),
      );
    } else {
      throw new Error(`unsupported_channel:${channel}`);
    }
  } catch (e) {
    const msg = String(e).slice(0, 500);
    const status = (e as any)?.status ?? null;
    const cls = classifyError(status, msg);
    await failEvent(supabase, ev, status, msg, cls);
    return;
  }

  // 6) Mark sent and mirror to tunnel
  await markSent(supabase, ev, aiText, model, null);
  mirrorToTunnel(supabase, ev, aiText).catch((e) =>
    console.warn('[openclaw-worker] mirror failed', ev.id, String(e).slice(0, 200)),
  );
}

// ---------------------------------------------------------------------------

async function loadHistory(supabase: any, ev: any, limit: number) {
  if (!ev.conversation_id) return [];
  const { data } = await supabase
    .from('messages')
    .select('role, content, created_at')
    .eq('conversation_id', ev.conversation_id)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? [])
    .reverse()
    .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: (m.content ?? '').slice(0, 1000) }));
}

async function sendDirectMessage(supabase: any, ev: any, text: string) {
  // ev.payload.sender_id is the PSID/IGSID. Page id is in payload.page_id.
  const pageId = ev.payload?.page_id;
  const recipientId = ev.payload?.sender_id;
  if (!pageId || !recipientId) throw new Error('missing_page_or_recipient');

  const { data: cred } = await supabase
    .from('meta_credentials')
    .select('access_token')
    .eq('page_id', pageId)
    .maybeSingle();
  if (!cred?.access_token) throw new Error('no_page_token');

  const res = await fetch(`https://graph.facebook.com/v25.0/me/messages`, {
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
  if (!res.ok) {
    const t = await res.text();
    const err: any = new Error(`graph_dm_${res.status}: ${t.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
}

async function sendPublicComment(supabase: any, ev: any, text: string) {
  const commentId = ev.payload?.comment_id;
  const pageId = ev.payload?.page_id;
  if (!commentId || !pageId) throw new Error('missing_comment_or_page');

  const { data: cred } = await supabase
    .from('meta_credentials')
    .select('access_token')
    .eq('page_id', pageId)
    .maybeSingle();
  if (!cred?.access_token) throw new Error('no_page_token');

  const res = await fetch(`https://graph.facebook.com/v25.0/${commentId}/comments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cred.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: text }),
  });
  if (!res.ok) {
    const t = await res.text();
    const err: any = new Error(`graph_comment_${res.status}: ${t.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
}

/** Best-effort: send a private DM to the commenter via Meta's private-replies API. */
async function sendPrivateReplyToCommenter(supabase: any, ev: any, text: string) {
  const commentId = ev.payload?.comment_id;
  const pageId = ev.payload?.page_id;
  if (!commentId || !pageId) return;

  const { data: cred } = await supabase
    .from('meta_credentials')
    .select('access_token')
    .eq('page_id', pageId)
    .maybeSingle();
  if (!cred?.access_token) return;

  // Same endpoint works for FB Messenger + IG (Meta routes by recipient.comment_id).
  const res = await fetch(`https://graph.facebook.com/v25.0/me/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cred.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient: { comment_id: commentId },
      message: { text: text.slice(0, 900) },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.log('[openclaw-worker] private-reply not delivered', { status: res.status, body: t.slice(0, 200) });
  }
}

// ---------------------------------------------------------------------------

async function mirrorToTunnel(supabase: any, ev: any, aiText: string | null) {
  const { data: company } = await supabase
    .from('companies')
    .select('openclaw_webhook_url, openclaw_webhook_token')
    .eq('id', ev.company_id)
    .maybeSingle();
  if (!company?.openclaw_webhook_url) return;

  const secret = Deno.env.get('OPENCLAW_WEBHOOK_SECRET') ?? '';
  const body = JSON.stringify({
    kind: 'notify_only',
    event_id: ev.id,
    company_id: ev.company_id,
    channel: ev.channel,
    source: ev.source,
    ai_response: aiText,
    inbound: ev.payload,
    sent_at: new Date().toISOString(),
  });

  let sigHeader = '';
  if (secret) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign'],
    );
    const buf = await crypto.subtle.sign('HMAC', key, enc.encode(body));
    sigHeader = 'sha256=' + Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  try {
    await fetch(company.openclaw_webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Openclaw-Kind': 'notify_only',
        ...(sigHeader ? { 'X-Openclaw-Signature': sigHeader } : {}),
        ...(company.openclaw_webhook_token ? { Authorization: `Bearer ${company.openclaw_webhook_token}` } : {}),
      },
      body,
      signal: AbortSignal.timeout(5_000),
    });
  } catch (e) {
    console.log('[openclaw-worker] mirror tunnel error', String(e).slice(0, 200));
  }
}

// ---------------------------------------------------------------------------

async function markSent(supabase: any, ev: any, text: string, model: string | null, tokens: number | null) {
  await supabase.from('inbound_events').update({
    status: 'sent',
    ai_response: text,
    model: model ?? ev.model,
    tokens: tokens ?? ev.tokens,
    completed_at: new Date().toISOString(),
    consumed_by: 'worker',
    last_error: null,
    error_class: null,
  }).eq('id', ev.id);
}


async function markSkipped(supabase: any, ev: any, reason: string) {
  await supabase.from('inbound_events').update({
    status: 'skipped',
    last_error: reason,
    completed_at: new Date().toISOString(),
  }).eq('id', ev.id);
}

async function failEvent(
  supabase: any,
  ev: any,
  status: number | null,
  errText: string,
  cls: string,
) {
  const attempts = (ev.attempts ?? 0) + 1;
  const dead = attempts >= MAX_ATTEMPTS;
  await supabase.from('inbound_events').update({
    status: dead ? 'dead' : 'pending',
    attempts,
    next_attempt_at: dead ? new Date().toISOString() : nextAttemptAt(attempts),
    last_error: `${cls}${status ? ` (${status})` : ''}: ${errText.slice(0, 480)}`,
    error_class: cls,
  }).eq('id', ev.id);
}

async function logAiError(supabase: any, ev: any, reason: string, detail: string) {
  try {
    await supabase.from('ai_error_logs').insert({
      company_id: ev.company_id,
      conversation_id: ev.conversation_id ?? null,
      error_type: reason,
      error_message: detail,
      context: { event_id: ev.id, channel: ev.channel, source: ev.source },
    });
  } catch { /* table may not have all cols — best-effort */ }
}
