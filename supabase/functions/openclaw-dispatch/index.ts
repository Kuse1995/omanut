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
    .select('id, name, openclaw_mode, openclaw_owns, openclaw_webhook_url, openclaw_drafter, business_type, metadata')
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
      // Inbound events that need immediate agent action (don't wait for poll)
      const inboundTriggers = new Set([
        'inbound_message', 'inbound_dm', 'inbound_comment',
        'whatsapp_inbound', 'meta_dm_inbound', 'comment_inbound',
      ]);
      const triggerNow = inboundTriggers.has(body.event_type) || body.channel === 'whatsapp' || body.channel === 'meta_dm' || body.channel === 'comments';

      // Surface frequently-needed fields at the top level so OpenClaw can act
      // without needing to parse the nested `payload` (its MCP parser has been brittle).
      const p: any = body.payload ?? {};
      const customerPhone = p.from ?? p.phone ?? p.sender ?? null;
      const customerName = p.profile_name ?? p.customer_name ?? p.commenter_name ?? null;
      const inboundText = p.body ?? p.text ?? p.message ?? null;

      // Extract inbound media URLs. Sources (in priority order):
      //   1. payload.media_urls / payload.mediaUrls   (already-normalized array)
      //   2. payload.MediaUrl0..MediaUrlN              (raw Twilio webhook fields)
      //   3. message_metadata.media_urls on the latest inbound DB row
      const collectedMedia: string[] = [];
      const pushUrl = (u: any) => { if (typeof u === 'string' && u.startsWith('http')) collectedMedia.push(u); };
      if (Array.isArray(p.media_urls)) p.media_urls.forEach(pushUrl);
      if (Array.isArray(p.mediaUrls)) p.mediaUrls.forEach(pushUrl);
      for (let i = 0; i < 10; i++) pushUrl(p[`MediaUrl${i}`]);

      if (collectedMedia.length === 0 && body.conversation_id) {
        try {
          const { data: lastMsg } = await supabase
            .from('messages')
            .select('message_metadata')
            .eq('conversation_id', body.conversation_id)
            .eq('role', 'user')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          const meta: any = lastMsg?.message_metadata ?? {};
          if (Array.isArray(meta.media_urls)) meta.media_urls.forEach(pushUrl);
        } catch (e) {
          console.warn('[openclaw-dispatch] media metadata load failed', String(e).slice(0, 200));
        }
      }

      // Twilio media URLs require basic auth — inline the credentials so OpenClaw
      // can fetch with a plain GET. Meta media URLs are signed and pass through.
      const twSid = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
      const twTok = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
      const inboundMediaUrls = collectedMedia.map((url) => {
        if (twSid && twTok && url.includes('api.twilio.com') && !url.includes('@')) {
          return url.replace('https://', `https://${twSid}:${twTok}@`);
        }
        return url;
      });

      // DRAFTER MODE: load recent history so OpenClaw can draft a contextual reply in one shot.
      let recentHistory: Array<{ role: string; content: string; at: string }> = [];
      if (company.openclaw_drafter && body.conversation_id) {
        try {
          const { data: msgs } = await supabase
            .from('messages')
            .select('role, content, created_at')
            .eq('conversation_id', body.conversation_id)
            .order('created_at', { ascending: false })
            .limit(8);
          recentHistory = (msgs ?? []).reverse().map((m: any) => ({
            role: m.role, content: (m.content ?? '').slice(0, 1000), at: m.created_at,
          }));
        } catch (e) {
          console.warn('[openclaw-dispatch] history load failed', String(e).slice(0, 200));
        }
      }

      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const replyToUrl = `${supabaseUrl}/functions/v1/openclaw-reply`;

      const bodyString = JSON.stringify({
        event_id: event.id,
        company_id: company.id,
        company_name: company.name,
        company_brief: {
          business_type: (company as any).business_type ?? null,
          sales_mode: (company as any).metadata?.sales_mode ?? null,
        },
        channel: body.channel,
        event_type: body.event_type,
        skill: body.skill,
        conversation_id: body.conversation_id,
        // Drafter mode signals
        drafter_mode: !!company.openclaw_drafter,
        reply_to_url: replyToUrl,
        reply_instructions: company.openclaw_drafter
          ? `Draft a reply for the customer and POST it to reply_to_url with body { event_id, reply_text, action: "send" } and header X-Openclaw-Signature: sha256=<HMAC-SHA256 of body using OPENCLAW_WEBHOOK_SECRET>. Do NOT send via Twilio. Use action: "handoff" to escalate to the boss, or "skip" to ignore.`
          : null,
        // Top-level convenience fields for the agent
        process_now: triggerNow,
        wake: triggerNow,
        trigger_reason: triggerNow ? 'inbound_realtime' : 'skill_request',
        customer_phone: customerPhone,
        customer_name: customerName,
        inbound_text: inboundText,
        recent_history: recentHistory,
        // Original payload preserved
        payload: p,
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

      const resp = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sigHeader ? { 'X-Openclaw-Signature': sigHeader } : {}),
          'X-Openclaw-Event-Id': event.id,
          'X-Openclaw-Event-Type': body.event_type,
          'X-Openclaw-Channel': body.channel,
          ...(triggerNow ? {
            'X-Openclaw-Trigger': 'process-now',
            'X-Openclaw-Priority': 'immediate',
            'X-Openclaw-Wake': '1',
          } : {}),
        },
        body: bodyString,
        signal: AbortSignal.timeout(10_000),
      });
      console.log('[openclaw-dispatch] sent', {
        event_id: event.id,
        company_id: company.id,
        channel: body.channel,
        event_type: body.event_type,
        trigger_now: triggerNow,
        status: resp.status,
      });
      dispatchStatus = resp.ok ? 'delivered' : `http_${resp.status}`;
      if (!resp.ok) dispatchError = (await resp.text()).slice(0, 500);
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
