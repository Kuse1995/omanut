// Cron-driven safety net: re-pings OpenClaw for events that were delivered
// but haven't been answered yet. Catches missed/asleep agent loops.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_TRIGGERS = 5;
const SCAN_LIMIT = 50;

async function sign(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return 'sha256=' + Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const secret = Deno.env.get('OPENCLAW_WEBHOOK_SECRET') ?? '';

  // Pull pending events that were delivered ≤10min ago and haven't been re-pinged in 25s.
  const { data: events, error } = await supabase
    .from('openclaw_events')
    .select('id, company_id, channel, event_type, conversation_id, payload, trigger_count, last_trigger_at, created_at')
    .eq('dispatch_status', 'delivered')
    .in('status', ['pending', 'processing'])
    .gt('created_at', new Date(Date.now() - 10 * 60_000).toISOString())
    .lt('trigger_count', MAX_TRIGGERS)
    .order('created_at', { ascending: true })
    .limit(SCAN_LIMIT);

  if (error) {
    console.error('[pending-trigger] scan failed', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }

  const cutoff = Date.now() - 25_000;
  const candidates = (events ?? []).filter((e: any) => {
    if (!e.last_trigger_at) return true;
    return new Date(e.last_trigger_at).getTime() < cutoff;
  });

  if (candidates.length === 0) {
    return new Response(JSON.stringify({ scanned: events?.length ?? 0, retriggered: 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
    });
  }

  // Resolve company webhook URLs in one go
  const companyIds = [...new Set(candidates.map((e: any) => e.company_id))];
  const { data: companies } = await supabase
    .from('companies')
    .select('id, name, openclaw_webhook_url')
    .in('id', companyIds);
  const urlByCompany = new Map<string, { name: string; url: string | null }>();
  for (const c of companies ?? []) urlByCompany.set(c.id, { name: c.name, url: c.openclaw_webhook_url });

  let retriggered = 0;
  let skipped = 0;
  let failed = 0;

  await Promise.all(candidates.map(async (ev: any) => {
    const co = urlByCompany.get(ev.company_id);
    if (!co?.url) { skipped++; return; }

    const p: any = ev.payload ?? {};
    const customerPhone = p.from ?? p.phone ?? p.sender ?? null;
    const customerName = p.profile_name ?? p.customer_name ?? p.commenter_name ?? null;
    const inboundText = p.body ?? p.text ?? p.message ?? null;

    const body = JSON.stringify({
      event_id: ev.id,
      company_id: ev.company_id,
      company_name: co.name,
      channel: ev.channel,
      event_type: ev.event_type,
      conversation_id: ev.conversation_id,
      process_now: true,
      wake: true,
      trigger_reason: 'pending_retry',
      customer_phone: customerPhone,
      customer_name: customerName,
      inbound_text: inboundText,
      payload: p,
      retry: (ev.trigger_count ?? 0) + 1,
      dispatched_at: new Date().toISOString(),
    });
    const sig = secret ? await sign(secret, body) : null;

    try {
      const r = await fetch(co.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Openclaw-Trigger': 'process-now',
          'X-Openclaw-Priority': 'immediate',
          'X-Openclaw-Wake': '1',
          'X-Openclaw-Event-Id': ev.id,
          'X-Openclaw-Event-Type': ev.event_type,
          'X-Openclaw-Channel': ev.channel,
          'X-Openclaw-Retry': String((ev.trigger_count ?? 0) + 1),
          ...(sig ? { 'X-Openclaw-Signature': sig } : {}),
        },
        body,
        signal: AbortSignal.timeout(8_000),
      });
      if (r.ok) retriggered++;
      else failed++;
    } catch (e) {
      failed++;
      console.warn('[pending-trigger] re-ping failed', ev.id, String(e).slice(0, 200));
    }

    const newCount = (ev.trigger_count ?? 0) + 1;
    await supabase
      .from('openclaw_events')
      .update({
        last_trigger_at: new Date().toISOString(),
        trigger_count: newCount,
      })
      .eq('id', ev.id);

    // Safety net: if we've hit MAX_TRIGGERS and event is still pending,
    // alert the boss so a stuck OpenClaw doesn't silently drop the customer.
    if (newCount >= MAX_TRIGGERS) {
      try {
        // Dedupe per event id
        const marker = `[openclaw-stuck:${ev.id}]`;
        const { data: existing } = await supabase
          .from('boss_conversations')
          .select('id')
          .eq('company_id', ev.company_id)
          .ilike('message_content', `%${marker}%`)
          .limit(1)
          .maybeSingle();
        if (!existing) {
          await supabase.functions.invoke('send-boss-notification', {
            body: {
              companyId: ev.company_id,
              notificationType: 'high_value_opportunity',
              data: {
                customer_name: customerName || 'Unknown',
                customer_phone: customerPhone || 'unknown',
                opportunity_type: 'OpenClaw not responding — please reply manually',
                details: `Inbound ${ev.channel} message reached OpenClaw ${MAX_TRIGGERS}× but no automated reply.\n\nMessage: "${(inboundText ?? '').toString().slice(0, 240)}"\n\nEvent: ${ev.id.slice(0, 8)}`,
                estimated_value: 'Unknown — please review',
              },
            },
          });
          await supabase.from('boss_conversations').insert({
            company_id: ev.company_id,
            message_from: 'system',
            message_content: `OpenClaw stuck-event alert ${marker}: ${ev.channel} ${ev.event_type}`,
            response: (inboundText ?? '').toString().slice(0, 200),
          });
          console.log('[pending-trigger] boss-alert sent for stuck event', ev.id);
        }
      } catch (e) {
        console.warn('[pending-trigger] boss alert failed', ev.id, String(e).slice(0, 200));
      }
    }
  }));

  console.log('[pending-trigger] done', { scanned: events?.length ?? 0, candidates: candidates.length, retriggered, failed, skipped });

  return new Response(JSON.stringify({
    scanned: events?.length ?? 0,
    candidates: candidates.length,
    retriggered, failed, skipped,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
  });
});
