// OpenClaw dispatcher: logs an event and forwards it to the company's OpenClaw webhook.
// Called from inbound handlers (whatsapp-messages, meta-webhook) and from skill-gating logic.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DispatchBody {
  company_id: string;
  channel: string;          // whatsapp | meta_dm | comments | content | bms | handoff | system
  event_type: string;       // inbound_message | skill_request | takeover_release | ...
  conversation_id?: string;
  skill?: string;
  payload?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let body: DispatchBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!body.company_id || !body.channel || !body.event_type) {
    return new Response(JSON.stringify({ error: 'missing_fields' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Look up company config
  const { data: company, error: cErr } = await supabase
    .from('companies')
    .select('id, name, openclaw_mode, openclaw_owns, openclaw_webhook_url')
    .eq('id', body.company_id)
    .single();

  if (cErr || !company) {
    return new Response(JSON.stringify({ error: 'company_not_found' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Insert event row
  const { data: event, error: eErr } = await supabase
    .from('openclaw_events')
    .insert({
      company_id: body.company_id,
      conversation_id: body.conversation_id ?? null,
      channel: body.channel,
      event_type: body.event_type,
      skill: body.skill ?? null,
      payload: body.payload ?? {},
      status: 'pending',
    })
    .select('id')
    .single();

  if (eErr) {
    console.error('[openclaw-dispatch] insert event failed', eErr);
    return new Response(JSON.stringify({ error: 'insert_failed', details: eErr.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Bump heartbeat (we treat dispatch attempt as the platform-side liveness signal — actual
  // heartbeat from OpenClaw is bumped when their MCP tools fire).
  // Forward to OpenClaw webhook if configured
  const webhookUrl = company.openclaw_webhook_url;
  let dispatchStatus = 'no_webhook';
  let dispatchError: string | null = null;

  if (webhookUrl) {
    try {
      const secret = Deno.env.get('OPENCLAW_WEBHOOK_SECRET') ?? '';
      const bodyString = JSON.stringify({
        event_id: event.id,
        company_id: company.id,
        company_name: company.name,
        channel: body.channel,
        event_type: body.event_type,
        skill: body.skill,
        conversation_id: body.conversation_id,
        payload: body.payload ?? {},
        dispatched_at: new Date().toISOString(),
      });

      let sigHeader: string | null = null;
      if (secret) {
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey(
          'raw',
          enc.encode(secret),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign'],
        );
        const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(bodyString));
        const hex = Array.from(new Uint8Array(sigBuf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        sigHeader = `sha256=${hex}`;
      } else {
        console.warn('[openclaw-dispatch] OPENCLAW_WEBHOOK_SECRET not set — sending unsigned');
      }

      // Inbound events that need immediate agent action (don't wait for poll)
      const inboundTriggers = new Set([
        'inbound_message', 'inbound_dm', 'inbound_comment',
        'whatsapp_inbound', 'meta_dm_inbound', 'comment_inbound',
      ]);
      const triggerNow = inboundTriggers.has(body.event_type) || body.channel === 'whatsapp' || body.channel === 'meta_dm' || body.channel === 'comments';

      const resp = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sigHeader ? { 'X-Openclaw-Signature': sigHeader } : {}),
          'X-Openclaw-Event-Id': event.id,
          'X-Openclaw-Event-Type': body.event_type,
          'X-Openclaw-Channel': body.channel,
          ...(triggerNow ? { 'X-Openclaw-Trigger': 'process-now', 'X-Openclaw-Priority': 'immediate' } : {}),
        },
        body: bodyString,
        signal: AbortSignal.timeout(10_000),
      });
      dispatchStatus = resp.ok ? 'delivered' : `http_${resp.status}`;
      if (!resp.ok) dispatchError = (await resp.text()).slice(0, 500);

      // Fire a second, lightweight execute-ping so OpenClaw runs its loop immediately
      // instead of waiting for a poll cycle. Best-effort, non-blocking on failure.
      if (triggerNow) {
        const executeUrl = webhookUrl.endsWith('/webhook')
          ? webhookUrl.slice(0, -'/webhook'.length) + '/execute'
          : webhookUrl.replace(/\/+$/, '') + '/execute';
        const pingBody = JSON.stringify({
          event_id: event.id,
          company_id: company.id,
          channel: body.channel,
          event_type: body.event_type,
          conversation_id: body.conversation_id ?? null,
          reason: 'inbound_event_trigger',
          dispatched_at: new Date().toISOString(),
        });
        let pingSig: string | null = null;
        if (secret) {
          const enc2 = new TextEncoder();
          const k2 = await crypto.subtle.importKey('raw', enc2.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
          const sb = await crypto.subtle.sign('HMAC', k2, enc2.encode(pingBody));
          pingSig = 'sha256=' + Array.from(new Uint8Array(sb)).map((b) => b.toString(16).padStart(2, '0')).join('');
        }
        // Don't await — fire and forget, but log outcome
        fetch(executeUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Openclaw-Trigger': 'process-now',
            'X-Openclaw-Event-Id': event.id,
            ...(pingSig ? { 'X-Openclaw-Signature': pingSig } : {}),
          },
          body: pingBody,
          signal: AbortSignal.timeout(5_000),
        })
          .then((r) => console.log('[openclaw-dispatch] execute-ping', executeUrl, r.status))
          .catch((e) => console.warn('[openclaw-dispatch] execute-ping failed', executeUrl, String(e).slice(0, 200)));
      }
    } catch (e) {
      dispatchStatus = 'error';
      dispatchError = String(e).slice(0, 500);
    }
  }

  await supabase
    .from('openclaw_events')
    .update({ dispatch_status: dispatchStatus, dispatch_error: dispatchError })
    .eq('id', event.id);

  // Successful webhook delivery counts as a heartbeat — keeps health-check from
  // demoting primary→assist when OpenClaw is actively receiving events.
  if (dispatchStatus === 'delivered') {
    await supabase
      .from('companies')
      .update({ openclaw_last_heartbeat: new Date().toISOString() })
      .eq('id', company.id);
  }

  return new Response(JSON.stringify({
    event_id: event.id,
    dispatch_status: dispatchStatus,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  });
});
