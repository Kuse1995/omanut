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

  // Look up company config (include KB-relevant fields for drafter context)
  const { data: company, error: cErr } = await supabase
    .from('companies')
    .select('id, name, openclaw_mode, openclaw_owns, openclaw_webhook_url, openclaw_webhook_token, openclaw_drafter, business_type, metadata, quick_reference_info, payment_instructions, payment_number_airtel, payment_number_mtn, payment_number_zamtel, currency_prefix, services, service_locations, hours, branches, voice_style, payments_disabled')
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
      const lookupUrl = `${supabaseUrl}/functions/v1/openclaw-lookup`;

      // Build the company knowledge context that the drafter needs to answer factually.
      const c: any = company;
      const companyContext = company.openclaw_drafter ? {
        name: c.name,
        business_type: c.business_type ?? null,
        sales_mode: c.metadata?.sales_mode ?? null,
        voice_style: c.voice_style ?? null,
        currency_prefix: c.currency_prefix ?? null,
        services: c.services ?? null,
        service_locations: c.service_locations ?? null,
        hours: c.hours ?? null,
        branches: c.branches ?? null,
        payment_instructions: c.payment_instructions ?? null,
        payment_numbers: {
          airtel: c.payment_number_airtel ?? null,
          mtn: c.payment_number_mtn ?? null,
          zamtel: c.payment_number_zamtel ?? null,
        },
        payments_disabled: !!c.payments_disabled,
        // The big curated KB — truncate defensively to keep payload reasonable.
        knowledge_base: typeof c.quick_reference_info === 'string'
          ? c.quick_reference_info.slice(0, 12000)
          : null,
        knowledge_base_truncated: typeof c.quick_reference_info === 'string' && c.quick_reference_info.length > 12000,
      } : null;

      // BMS snapshot — refresh via bms-training-sync if cache is stale (>15 min).
      let bmsSnapshot: { text: string; synced_at: string | null } | null = null;
      if (company.openclaw_drafter) {
        try {
          const { data: bmsRow } = await supabase
            .from('bms_connections')
            .select('last_kb_text, last_bms_sync_at, is_active')
            .eq('company_id', company.id)
            .eq('is_active', true)
            .maybeSingle();
          if (bmsRow) {
            const stale = !bmsRow.last_bms_sync_at ||
              (Date.now() - new Date(bmsRow.last_bms_sync_at).getTime()) > 15 * 60 * 1000;
            if (stale || !bmsRow.last_kb_text) {
              // Fire training sync and capture formatted_text.
              try {
                const syncRes = await fetch(`${supabaseUrl}/functions/v1/bms-training-sync`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}`,
                  },
                  body: JSON.stringify({ company_id: company.id }),
                  signal: AbortSignal.timeout(8_000),
                });
                const syncJson: any = await syncRes.json().catch(() => ({}));
                if (syncJson?.formatted_text) {
                  await supabase
                    .from('bms_connections')
                    .update({ last_kb_text: syncJson.formatted_text })
                    .eq('company_id', company.id);
                  bmsSnapshot = { text: syncJson.formatted_text.slice(0, 8000), synced_at: new Date().toISOString() };
                } else if (bmsRow.last_kb_text) {
                  bmsSnapshot = { text: bmsRow.last_kb_text.slice(0, 8000), synced_at: bmsRow.last_bms_sync_at };
                }
              } catch (e) {
                console.warn('[openclaw-dispatch] bms sync failed, using cache', String(e).slice(0, 200));
                if (bmsRow.last_kb_text) {
                  bmsSnapshot = { text: bmsRow.last_kb_text.slice(0, 8000), synced_at: bmsRow.last_bms_sync_at };
                }
              }
            } else {
              bmsSnapshot = { text: bmsRow.last_kb_text.slice(0, 8000), synced_at: bmsRow.last_bms_sync_at };
            }
          }
        } catch (e) {
          console.warn('[openclaw-dispatch] bms snapshot load failed', String(e).slice(0, 200));
        }
      }

      // Tool-first design: do NOT inline the full KB / BMS catalog. The agent has
      // `search_knowledge_base`, `bms_check_stock`, `bms_list_products` MCP tools that
      // pull live, ranked snippets. Send only a tiny hint of what's available.
      const kbSummary = typeof companyContext?.knowledge_base === 'string'
        ? companyContext.knowledge_base.slice(0, 600)
        : null;
      const bmsAvailable = !!bmsSnapshot?.text;

      const bodyString = JSON.stringify({
        event_id: event.id,
        company_id: company.id,
        company_name: company.name,
        company_brief: {
          business_type: (company as any).business_type ?? null,
          sales_mode: (company as any).metadata?.sales_mode ?? null,
          voice_style: (company as any).voice_style ?? null,
          currency_prefix: (company as any).currency_prefix ?? null,
          payments_disabled: !!(company as any).payments_disabled,
        },
        // Hint only — full data is reachable via tools.
        kb_summary: kbSummary,
        kb_available: !!kbSummary,
        bms_available: bmsAvailable,
        lookup_url: company.openclaw_drafter ? lookupUrl : null,
        lookup_intents: company.openclaw_drafter ? ['search_kb', 'check_stock', 'list_products', 'get_pricing', 'low_stock_alerts', 'get_sales_summary'] : null,
        channel: body.channel,
        event_type: body.event_type,
        skill: body.skill,
        conversation_id: body.conversation_id,
        // Drafter mode signals
        drafter_mode: !!company.openclaw_drafter,
        reply_to_url: replyToUrl,
        reply_instructions: company.openclaw_drafter
          ? [
              `You ARE the official ${company.name} agent. Reply in the company voice_style.`,
              `TOOL-FIRST: Before drafting any factual answer (fees, prices, hours, payment numbers, policies, services, contact info, products, stock), CALL the MCP tool \`search_knowledge_base\` with the customer's question as the query. Quote the returned snippets verbatim.`,
              `For product/inventory questions also call \`bms_check_stock\` or \`bms_list_products\`.`,
              `Fallback (if MCP tools unavailable): POST to lookup_url with { company_id, intent: "search_kb", query } and header X-Openclaw-Signature: sha256=<HMAC-SHA256 of body using OPENCLAW_WEBHOOK_SECRET>.`,
              `When ready, POST { event_id, reply_text, action: "send" } to reply_to_url with the same X-Openclaw-Signature header. Do NOT send via Twilio yourself.`,
              `Use action: "handoff" ONLY if search_knowledge_base AND the BMS tools BOTH return empty for the question. Generic "contact admissions/sales" replies when the data is in the KB are forbidden.`,
              `Keep replies 1-3 sentences for simple questions; quote full schedules when asked about fees/pricing.`,
            ].join(' ')
          : null,
        // Top-level convenience fields for the agent
        process_now: triggerNow,
        wake: triggerNow,
        trigger_reason: triggerNow ? 'inbound_realtime' : 'skill_request',
        customer_phone: customerPhone,
        customer_name: customerName,
        inbound_text: inboundText,
        inbound: {
          text: inboundText,
          media_urls: inboundMediaUrls,
          media_count: inboundMediaUrls.length,
        },
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

      // Per-company gateway token (e.g. OpenClaw's `gateway.auth.token`).
      // Falls back to a global OPENCLAW_GATEWAY_TOKEN env var so we can ship a
      // sane default for all companies without having to set the column on each.
      const gatewayToken = (company as any).openclaw_webhook_token
        || Deno.env.get('OPENCLAW_GATEWAY_TOKEN')
        || '';

      const resp = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sigHeader ? { 'X-Openclaw-Signature': sigHeader } : {}),
          ...(gatewayToken ? {
            'Authorization': `Bearer ${gatewayToken}`,
            'X-Api-Key': gatewayToken,
          } : {}),
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

  // ── Classify failures so logs/queries are useful, and detect dead tunnels.
  // Dead-tunnel signals: localhost.run "no tunnel here", Cloudflare tunnel error pages,
  // DNS lookup failures, HTTP 502/503/504/530 from tunnel front-ends.
  const rawErr = (dispatchError ?? '').toLowerCase();
  let failureReason: string | null = null;
  let isDeadTunnel = false;
  if (dispatchStatus === 'delivered' || dispatchStatus === 'no_webhook') {
    // success / no-op — nothing to classify
  } else if (
    rawErr.includes('no tunnel here') ||
    rawErr.includes('cloudflare tunnel error') ||
    rawErr.includes('error 1033') ||
    rawErr.includes('error 1016') ||
    dispatchStatus === 'http_530'
  ) {
    failureReason = 'tunnel_offline';
    isDeadTunnel = true;
  } else if (rawErr.includes('failed to lookup address') || rawErr.includes('dns error')) {
    failureReason = 'dns_error';
    isDeadTunnel = true;
  } else if (dispatchStatus === 'http_502' || dispatchStatus === 'http_503' || dispatchStatus === 'http_504') {
    failureReason = 'tunnel_unavailable';
    isDeadTunnel = true;
  } else if (dispatchStatus === 'http_404') {
    // Customer tunnel is up but `/webhook` (or whatever path was registered) isn't mounted.
    // Treat as dead-tunnel-class so the auto-disable counter kicks in and we stop dispatching
    // into a misconfigured route forever.
    failureReason = 'webhook_path_not_found';
    isDeadTunnel = true;
  } else if (dispatchStatus === 'error') {
    failureReason = rawErr.includes('timeout') ? 'timeout' : 'transport_error';
  } else if (dispatchStatus.startsWith('http_4')) {
    failureReason = 'webhook_client_error';
  } else if (dispatchStatus.startsWith('http_5')) {
    failureReason = 'webhook_server_error';
  }
  const taggedError = failureReason
    ? `${failureReason}: ${(dispatchError ?? '').slice(0, 460)}`
    : dispatchError;

  // Mark dead-tunnel events as `failed` immediately — they have no realistic chance of
  // being delivered until the tunnel is restored, so they shouldn't pollute the
  // pending-event queue forever.
  const newEventStatus = isDeadTunnel ? 'failed' : 'pending';

  await supabase
    .from('openclaw_events')
    .update({
      dispatch_status: dispatchStatus,
      dispatch_error: taggedError,
      status: newEventStatus,
    })
    .eq('id', event.id);

  // ── Track consecutive dead-tunnel failures per company. After 5 in a row, auto-disable
  // the webhook URL and ping the boss once so a stale tunnel stops silently dropping messages.
  const DEAD_TUNNEL_DISABLE_THRESHOLD = 5;
  if (webhookUrl) {
    if (isDeadTunnel) {
      const newCount = ((company as any).openclaw_consecutive_failures ?? 0) + 1;
      const updates: Record<string, unknown> = {
        openclaw_consecutive_failures: newCount,
        openclaw_last_failure_at: new Date().toISOString(),
      };
      let autoDisabled = false;
      if (newCount >= DEAD_TUNNEL_DISABLE_THRESHOLD && (company as any).openclaw_webhook_url) {
        updates.openclaw_webhook_url = null;
        updates.openclaw_auto_disabled_at = new Date().toISOString();
        autoDisabled = true;
      }
      await supabase.from('companies').update(updates).eq('id', company.id);

      if (autoDisabled) {
        try {
          await supabase.functions.invoke('send-boss-notification', {
            body: {
              companyId: company.id,
              notificationType: 'high_value_opportunity',
              data: {
                customer_name: 'OpenClaw infrastructure',
                customer_phone: 'system',
                opportunity_type: 'OpenClaw tunnel offline — webhook auto-disabled',
                details: `The OpenClaw webhook for ${company.name} has failed ${newCount} times in a row (reason: ${failureReason}). The webhook URL has been cleared so we stop dispatching into a dead tunnel. Run the MCP tool register_webhook with a live tunnel URL to re-enable.\n\nLast error: ${(taggedError ?? '').slice(0, 200)}`,
                estimated_value: 'Customer messages currently NOT being answered',
              },
            },
          });
          console.log('[openclaw-dispatch] auto-disabled dead tunnel', { company_id: company.id, reason: failureReason, failures: newCount });
        } catch (e) {
          console.warn('[openclaw-dispatch] boss notify after auto-disable failed', String(e).slice(0, 200));
        }
      }
    } else if (dispatchStatus === 'delivered' && ((company as any).openclaw_consecutive_failures ?? 0) > 0) {
      // Recovery — reset the counter once we get a successful delivery.
      await supabase.from('companies').update({
        openclaw_consecutive_failures: 0,
        openclaw_last_failure_at: null,
      }).eq('id', company.id);
    }
  }

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
