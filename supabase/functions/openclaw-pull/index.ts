// openclaw-pull — long-poll endpoint. OpenClaw GETs this; we hold the
// connection up to `wait` seconds and return as soon as pending events appear.
//
// Auth:
//   Authorization: Bearer <OPENCLAW_GATEWAY_TOKEN>
// Optional:
//   X-Openclaw-Company: <company_id>  (scope to a single tenant; omit to drain all)
// Query:
//   max  = batch size (default 10, capped at 50)
//   wait = max seconds to long-poll (default 25, capped at 55)
//
// Response: { events: [ { ...envelope, signature } ] }   (200, never blocks for >wait)

import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildEnvelope } from '../_shared/openclaw-envelope.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-openclaw-company',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const GATEWAY_TOKEN = Deno.env.get('OPENCLAW_GATEWAY_TOKEN') ?? '';
const WEBHOOK_SECRET = Deno.env.get('OPENCLAW_WEBHOOK_SECRET') ?? null;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // Auth
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!GATEWAY_TOKEN || token !== GATEWAY_TOKEN) {
    try {
      const sb = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      await sb.from('openclaw_pull_log').insert({
        endpoint: 'openclaw-pull',
        events_returned: 0,
        status_code: 401,
        user_agent: req.headers.get('user-agent')?.slice(0, 200) ?? null,
        remote_ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      });
    } catch { /* noop */ }
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  const max = Math.max(1, Math.min(50, Number(url.searchParams.get('max') ?? '10')));
  const wait = Math.max(0, Math.min(55, Number(url.searchParams.get('wait') ?? '25')));
  const companyId = req.headers.get('x-openclaw-company') || url.searchParams.get('company_id') || null;

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const deadline = Date.now() + wait * 1000;
  let claimed: any[] = [];

  // Poll loop — try to claim, sleep 1s, repeat until we have events or deadline hits.
  while (true) {
    const { data, error } = await supabase.rpc('claim_pending_events', {
      _company_id: companyId,
      _max: max,
      _claimed_by: 'openclaw',
    });
    if (error) {
      console.error('[openclaw-pull] claim error', error);
      return new Response(JSON.stringify({ error: 'claim_failed', detail: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (data && data.length > 0) {
      claimed = data;
      break;
    }
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Build envelopes
  const events = [];
  for (const ev of claimed) {
    try {
      const { envelope, signature } = await buildEnvelope(supabase, ev, { signSecret: WEBHOOK_SECRET });
      events.push({ ...envelope, signature });
    } catch (e) {
      console.warn('[openclaw-pull] envelope build failed', ev.id, String(e).slice(0, 200));
      // Release this row back to pending so it's not lost.
      await supabase.from('inbound_events').update({
        status: 'pending', claimed_by: null, claimed_at: null,
      }).eq('id', ev.id);
    }
  }

  // Log this pull call so admins can see in /admin/sandbox-console that
  // OpenClaw's external loop is actually hitting us.
  try {
    await supabase.from('openclaw_pull_log').insert({
      endpoint: 'openclaw-pull',
      company_id: companyId,
      events_returned: events.length,
      wait_seconds: wait,
      status_code: 200,
      user_agent: req.headers.get('user-agent')?.slice(0, 200) ?? null,
      remote_ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    });
  } catch (e) {
    console.warn('[openclaw-pull] log insert failed', String(e).slice(0, 200));
  }

  return new Response(JSON.stringify({ events, count: events.length }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
