import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { authenticate, corsHeaders, metaFetch, META_GRAPH } from "../_shared/meta-ads.ts";

// Cron-friendly: pulls last 7 days of insights for every non-archived campaign.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const ctx = await authenticate(req);
    if (ctx instanceof Response) return ctx;

    const { data: campaigns } = await ctx.supabase
      .from('meta_ad_campaigns')
      .select('id, company_id, credential_id, meta_campaign_id, status')
      .not('meta_campaign_id', 'is', null)
      .in('status', ['ACTIVE','PAUSED']);

    if (!campaigns?.length) {
      return new Response(JSON.stringify({ synced: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let synced = 0;
    for (const c of campaigns) {
      const { data: cred } = await ctx.supabase
        .from('meta_credentials')
        .select('access_token')
        .eq('id', c.credential_id)
        .maybeSingle();
      if (!cred?.access_token) continue;

      const url = `${META_GRAPH}/${c.meta_campaign_id}/insights`
        + `?fields=spend,impressions,reach,clicks,actions,cost_per_action_type`
        + `&time_increment=1&date_preset=last_7d`
        + `&access_token=${encodeURIComponent(cred.access_token)}`;
      const { ok, json } = await metaFetch(url);
      if (!ok) {
        console.error('[insights] failed for', c.id, json);
        continue;
      }
      for (const row of (json?.data || [])) {
        const spendCents = Math.round(parseFloat(row.spend || '0') * 100);
        const impressions = parseInt(row.impressions || '0', 10);
        const reach = parseInt(row.reach || '0', 10);
        const clicks = parseInt(row.clicks || '0', 10);
        const results = (row.actions || []).reduce((sum: number, a: any) => sum + parseInt(a.value || '0', 10), 0);
        const cprRaw = (row.cost_per_action_type || [])[0]?.value;
        const cpr = cprRaw ? Math.round(parseFloat(cprRaw) * 100) : null;

        await ctx.supabase.from('meta_ad_insights_daily').upsert({
          campaign_id: c.id,
          company_id: c.company_id,
          date: row.date_start,
          spend_cents: spendCents,
          impressions, reach, clicks, results,
          cost_per_result_cents: cpr,
          raw: row,
        }, { onConflict: 'campaign_id,date' });
        synced++;
      }
    }

    return new Response(JSON.stringify({ synced, campaigns: campaigns.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal error';
    console.error('[meta-ads-sync-insights]', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
