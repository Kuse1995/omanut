import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import { authenticate, corsHeaders, assertOwner, loadCredential, metaFetch, META_GRAPH, humanizeMetaError, logAudit } from "../_shared/meta-ads.ts";

const BodySchema = z.object({
  campaign_id: z.string().uuid(),
  action: z.enum(['pause','resume','end','delete']),
});

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const ctx = await authenticate(req);
    if (ctx instanceof Response) return ctx;

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: 'Invalid input' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { campaign_id, action } = parsed.data;

    const { data: campaign } = await ctx.supabase
      .from('meta_ad_campaigns')
      .select('*')
      .eq('id', campaign_id)
      .maybeSingle();
    if (!campaign) {
      return new Response(JSON.stringify({ error: 'Campaign not found.' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!ctx.isServiceRole && !(await assertOwner(ctx.supabase, ctx.userId, campaign.company_id))) {
      return new Response(JSON.stringify({ error: 'Only company owners can manage ads.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cred = await loadCredential(ctx.supabase, campaign.credential_id, campaign.company_id);
    if (!cred) {
      return new Response(JSON.stringify({ error: 'Credential missing.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const before = { status: campaign.status };
    let nextStatus = campaign.status;

    if (campaign.meta_campaign_id) {
      if (action === 'pause' || action === 'end') {
        nextStatus = action === 'end' ? 'ARCHIVED' : 'PAUSED';
        const r = await metaFetch(`${META_GRAPH}/${campaign.meta_campaign_id}`, {
          method: 'POST',
          body: new URLSearchParams({ status: nextStatus, access_token: cred.access_token }),
        });
        if (!r.ok) {
          return new Response(JSON.stringify({ error: humanizeMetaError(r.json) }), {
            status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } else if (action === 'resume') {
        nextStatus = 'ACTIVE';
        const r = await metaFetch(`${META_GRAPH}/${campaign.meta_campaign_id}`, {
          method: 'POST',
          body: new URLSearchParams({ status: 'ACTIVE', access_token: cred.access_token }),
        });
        if (!r.ok) {
          return new Response(JSON.stringify({ error: humanizeMetaError(r.json) }), {
            status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } else if (action === 'delete') {
        await metaFetch(`${META_GRAPH}/${campaign.meta_campaign_id}?access_token=${encodeURIComponent(cred.access_token)}`, { method: 'DELETE' });
        nextStatus = 'DELETED';
      }
    }

    if (action === 'delete') {
      await ctx.supabase.from('meta_ad_campaigns').delete().eq('id', campaign_id);
    } else {
      await ctx.supabase.from('meta_ad_campaigns').update({ status: nextStatus }).eq('id', campaign_id);
    }

    await logAudit(ctx.supabase, campaign.company_id, campaign_id, ctx.userId, action, before, { status: nextStatus });

    return new Response(JSON.stringify({ success: true, status: nextStatus }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal error';
    console.error('[meta-ads-control]', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
