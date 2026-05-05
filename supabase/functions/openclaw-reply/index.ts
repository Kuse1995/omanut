// OpenClaw reply receiver: OpenClaw POSTs a drafted reply here, Omanut sends it.
// This is the "drafter" mode — Omanut owns delivery on Twilio/Meta, OpenClaw just writes the text.
//
// Body: { event_id, reply_text, media_url?, action?: 'send'|'handoff'|'skip', metadata? }
// Auth: HMAC-SHA256 over raw body in `X-Openclaw-Signature: sha256=<hex>` using OPENCLAW_WEBHOOK_SECRET.

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-openclaw-signature',
};

async function verifySignature(secret: string, body: string, header: string | null): Promise<boolean> {
  if (!secret) return true; // dev/escape hatch — log a warning elsewhere
  if (!header) return false;
  const expected = header.replace(/^sha256=/, '').toLowerCase();
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  const got = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
  // constant-time-ish compare
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function jsonResp(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResp(405, { error: 'method_not_allowed' });

  const raw = await req.text();
  const secret = Deno.env.get('OPENCLAW_WEBHOOK_SECRET') ?? '';
  const sigHeader = req.headers.get('X-Openclaw-Signature');
  const ok = await verifySignature(secret, raw, sigHeader);
  if (!ok) {
    console.warn('[openclaw-reply] invalid signature');
    return jsonResp(401, { error: 'invalid_signature' });
  }

  let body: any;
  try { body = JSON.parse(raw); } catch { return jsonResp(400, { error: 'invalid_json' }); }

  const { event_id, reply_text, media_url, action } = body ?? {};
  if (!event_id) return jsonResp(400, { error: 'missing_event_id' });
  const act: 'send' | 'handoff' | 'skip' = action ?? 'send';
  if (act === 'send' && !reply_text && !media_url) {
    return jsonResp(400, { error: 'reply_text_or_media_required' });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Load event
  const { data: event, error: eErr } = await supabase
    .from('openclaw_events')
    .select('id, company_id, conversation_id, channel, payload, status')
    .eq('id', event_id)
    .maybeSingle();
  if (eErr || !event) return jsonResp(404, { error: 'event_not_found' });
  if (event.status === 'answered') {
    return jsonResp(200, { status: 'already_answered', event_id });
  }

  const p: any = event.payload ?? {};
  const customerPhone = p.from ?? p.phone ?? p.sender ?? null;

  // Skip / handoff actions just mark the event without sending.
  if (act === 'skip' || act === 'handoff') {
    await supabase.from('openclaw_events').update({
      status: 'answered',
      answered_at: new Date().toISOString(),
      answered_by: 'openclaw',
      answered_action: act,
      payload: { ...p, openclaw_reply: reply_text ?? null, openclaw_action: act },
    }).eq('id', event_id);
    if (act === 'handoff') {
      // Forward to boss so a human picks it up
      try {
        await supabase.functions.invoke('send-boss-notification', {
          body: {
            companyId: event.company_id,
            notificationType: 'high_value_opportunity',
            data: {
              customer_name: p.profile_name ?? p.customer_name ?? 'Unknown',
              customer_phone: customerPhone ?? 'unknown',
              opportunity_type: 'OpenClaw requested human handoff',
              details: reply_text ?? 'No additional context.',
            },
          },
        });
      } catch (e) {
        console.warn('[openclaw-reply] handoff boss-notify failed', String(e).slice(0, 200));
      }
    }
    return jsonResp(200, { status: 'ok', action: act, event_id });
  }

  // Dedupe: if we just sent the same text in last 30s on this conversation, skip.
  if (event.conversation_id && reply_text) {
    const { data: recent } = await supabase
      .from('messages')
      .select('id, content, created_at')
      .eq('conversation_id', event.conversation_id)
      .eq('role', 'assistant')
      .gt('created_at', new Date(Date.now() - 30_000).toISOString())
      .order('created_at', { ascending: false })
      .limit(3);
    const dup = (recent ?? []).find((m: any) => (m.content ?? '').trim() === reply_text.trim());
    if (dup) {
      await supabase.from('openclaw_events').update({
        status: 'answered',
        answered_at: new Date().toISOString(),
        answered_by: 'openclaw',
        answered_action: 'duplicate_suppressed',
        payload: { ...p, openclaw_reply: reply_text },
      }).eq('id', event_id);
      return jsonResp(200, { status: 'duplicate_suppressed', event_id });
    }
  }

  // Look up company for provider routing
  const { data: company } = await supabase
    .from('companies')
    .select('id, whatsapp_provider, openclaw_drafter')
    .eq('id', event.company_id)
    .maybeSingle();

  // Auth header for invoking other functions (service role)
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const invokeOpts = (b: any) => ({ body: b, headers: { Authorization: `Bearer ${serviceKey}` } });

  let sendStatus: 'sent' | 'failed' = 'failed';
  let sendError: string | null = null;
  let routedTo = 'unknown';

  try {
    if (event.channel === 'whatsapp') {
      if (company?.whatsapp_provider === 'meta_cloud') {
        routedTo = 'send-whatsapp-cloud';
        const { error } = await supabase.functions.invoke('send-whatsapp-cloud', invokeOpts({
          company_id: event.company_id,
          to: customerPhone,
          body: reply_text,
          media_url: media_url ?? undefined,
        }));
        if (error) throw error;
      } else {
        routedTo = 'send-whatsapp-message';
        const { error } = await supabase.functions.invoke('send-whatsapp-message', invokeOpts({
          conversationId: event.conversation_id,
          phone: customerPhone,
          company_id: event.company_id,
          message: reply_text,
          mediaUrl: media_url ?? undefined,
        }));
        if (error) throw error;
      }
      sendStatus = 'sent';
    } else if (event.channel === 'meta_dm') {
      routedTo = 'send-meta-dm';
      const { error } = await supabase.functions.invoke('send-meta-dm', invokeOpts({
        conversationId: event.conversation_id,
        text: reply_text,
      }));
      if (error) throw error;
      sendStatus = 'sent';
    } else if (event.channel === 'comments') {
      routedTo = 'send-facebook-comment-reply';
      const commentId = p.comment_id ?? p.object_id ?? null;
      if (!commentId) throw new Error('missing_comment_id_in_payload');
      const { error } = await supabase.functions.invoke('send-facebook-comment-reply', invokeOpts({
        comment_id: commentId,
        message: reply_text,
        company_id: event.company_id,
      }));
      if (error) throw error;
      sendStatus = 'sent';
    } else {
      throw new Error(`unsupported_channel:${event.channel}`);
    }
  } catch (e) {
    sendError = String(e instanceof Error ? e.message : e).slice(0, 500);
    console.error('[openclaw-reply] send failed', { event_id, routedTo, sendError });
  }

  await supabase.from('openclaw_events').update({
    status: sendStatus === 'sent' ? 'answered' : 'pending',
    answered_at: sendStatus === 'sent' ? new Date().toISOString() : null,
    answered_by: sendStatus === 'sent' ? 'openclaw' : null,
    answered_action: sendStatus === 'sent' ? `sent_via_${routedTo}` : null,
    payload: { ...p, openclaw_reply: reply_text, openclaw_media: media_url ?? null, send_error: sendError },
  }).eq('id', event_id);

  return jsonResp(sendStatus === 'sent' ? 200 : 502, {
    status: sendStatus,
    event_id,
    routed_to: routedTo,
    error: sendError,
  });
});
