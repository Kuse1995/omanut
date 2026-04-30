// OpenClaw health check: runs every 5 min via cron.
// Auto-flips a company from 'primary' -> 'assist' ONLY IF:
//   1) openclaw_last_heartbeat is older than 30 min (or null), AND
//   2) there are pending openclaw_events from the last 30 min.
// Silence with no pending events = OpenClaw alive but quiet, no flip.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STALENESS_MS = 30 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const cutoff = new Date(Date.now() - STALENESS_MS).toISOString();

  const { data: companies, error } = await supabase
    .from('companies')
    .select('id, name, boss_phone, openclaw_last_heartbeat')
    .eq('openclaw_mode', 'primary');

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let flipped = 0;
  const flippedNames: string[] = [];

  for (const c of companies ?? []) {
    const lastHb = c.openclaw_last_heartbeat ? new Date(c.openclaw_last_heartbeat).getTime() : 0;
    const stale = !lastHb || lastHb < Date.now() - STALENESS_MS;
    if (!stale) continue;

    // Are there pending events in the last 30 min?
    const { count: pendingCount } = await supabase
      .from('openclaw_events')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', c.id)
      .eq('status', 'pending')
      .gte('created_at', cutoff);

    if ((pendingCount ?? 0) === 0) continue; // alive but quiet, leave alone

    // Flip to assist + notify boss
    await supabase
      .from('companies')
      .update({ openclaw_mode: 'assist' })
      .eq('id', c.id);

    flipped++;
    flippedNames.push(c.name);

    if (c.boss_phone) {
      try {
        await supabase.functions.invoke('send-boss-notification', {
          body: {
            companyId: c.id,
            message: `⚠️ OpenClaw appears disconnected — internal AI resumed. Reconnect to take back over.\n\nWe noticed ${pendingCount} pending message(s) and no heartbeat from OpenClaw in the last 30 minutes.`,
          },
        });
      } catch (e) {
        console.error('[openclaw-health-check] boss notify failed', c.id, e);
      }
    }
  }

  return new Response(JSON.stringify({
    checked: companies?.length ?? 0,
    flipped,
    flipped_companies: flippedNames,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  });
});
