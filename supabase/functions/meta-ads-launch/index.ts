import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import {
  authenticate, corsHeaders, assertOwner, loadCredential, metaFetch,
  META_GRAPH, humanizeMetaError, logAudit, MAX_DAILY_BUDGET_CENTS,
} from "../_shared/meta-ads.ts";

const TargetingSchema = z.object({
  geo_countries: z.array(z.string()).default([]),
  age_min: z.number().int().min(13).max(65).default(18),
  age_max: z.number().int().min(13).max(65).default(65),
  genders: z.array(z.number().int()).default([]), // 1 male, 2 female, [] all
  interests: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
});

const CreativeSchema = z.object({
  message: z.string().min(1).max(5000),
  link: z.string().url().optional(),
  call_to_action: z.string().optional(),
  image_url: z.string().url().optional(),
  image_hash: z.string().optional(),
});

const BodySchema = z.object({
  company_id: z.string().uuid(),
  credential_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  objective: z.enum(['OUTCOME_TRAFFIC','OUTCOME_ENGAGEMENT','OUTCOME_LEADS','OUTCOME_SALES','OUTCOME_AWARENESS']),
  daily_budget_cents: z.number().int().positive().max(MAX_DAILY_BUDGET_CENTS).optional(),
  lifetime_budget_cents: z.number().int().positive().optional(),
  start_at: z.string().datetime().optional(),
  end_at: z.string().datetime().optional(),
  targeting: TargetingSchema,
  creative: CreativeSchema,
  launch: z.boolean().default(false), // false = save as PAUSED draft
});

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const ctx = await authenticate(req);
    if (ctx instanceof Response) return ctx;

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: 'Invalid input', details: parsed.error.flatten() }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const b = parsed.data;

    if (!b.daily_budget_cents && !b.lifetime_budget_cents) {
      return new Response(JSON.stringify({ error: 'Either daily_budget_cents or lifetime_budget_cents is required.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!ctx.isServiceRole && !(await assertOwner(ctx.supabase, ctx.userId, b.company_id))) {
      return new Response(JSON.stringify({ error: 'Only company owners can launch ads.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cred = await loadCredential(ctx.supabase, b.credential_id, b.company_id);
    if (!cred || !cred.ad_account_id) {
      return new Response(JSON.stringify({ error: 'Credential or ad_account_id missing. Verify access first.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const acctId = cred.ad_account_id.startsWith('act_') ? cred.ad_account_id : `act_${cred.ad_account_id}`;
    const token = cred.access_token;

    // Insert local draft first (PAUSED), then create on Meta. If Meta succeeds, flip to PAUSED/ACTIVE accordingly.
    const targetStatus = b.launch ? 'ACTIVE' : 'PAUSED';

    const { data: localCampaign, error: insertErr } = await ctx.supabase
      .from('meta_ad_campaigns')
      .insert({
        company_id: b.company_id,
        credential_id: b.credential_id,
        name: b.name,
        objective: b.objective,
        status: 'CREATING',
        daily_budget_cents: b.daily_budget_cents ?? null,
        lifetime_budget_cents: b.lifetime_budget_cents ?? null,
        currency: 'USD', // will be updated from ad account if available
        start_at: b.start_at ?? null,
        end_at: b.end_at ?? null,
        creative_payload: b.creative,
        targeting: b.targeting,
        created_by: ctx.userId || null,
      })
      .select()
      .single();

    if (insertErr || !localCampaign) {
      return new Response(JSON.stringify({ error: insertErr?.message || 'Failed to create local campaign.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const fail = async (msg: string) => {
      await ctx.supabase.from('meta_ad_campaigns')
        .update({ status: 'FAILED', last_error: msg })
        .eq('id', localCampaign.id);
      return new Response(JSON.stringify({ error: msg, campaign_id: localCampaign.id }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    };

    // 1. Create Campaign
    const campaignBody = new URLSearchParams({
      name: b.name,
      objective: b.objective,
      status: 'PAUSED',
      special_ad_categories: '[]',
      access_token: token,
    });
    const camp = await metaFetch(`${META_GRAPH}/${acctId}/campaigns`, {
      method: 'POST', body: campaignBody,
    });
    if (!camp.ok) return await fail(humanizeMetaError(camp.json));
    const metaCampaignId = camp.json.id;

    // 2. Create Ad Set
    const adsetParams: Record<string, string> = {
      name: `${b.name} – Ad Set`,
      campaign_id: metaCampaignId,
      billing_event: 'IMPRESSIONS',
      optimization_goal: b.objective === 'OUTCOME_LEADS' ? 'LEAD_GENERATION'
        : b.objective === 'OUTCOME_TRAFFIC' ? 'LINK_CLICKS'
        : b.objective === 'OUTCOME_ENGAGEMENT' ? 'POST_ENGAGEMENT'
        : b.objective === 'OUTCOME_SALES' ? 'OFFSITE_CONVERSIONS'
        : 'REACH',
      status: 'PAUSED',
      access_token: token,
      targeting: JSON.stringify({
        geo_locations: { countries: b.targeting.geo_countries.length ? b.targeting.geo_countries : ['US'] },
        age_min: b.targeting.age_min,
        age_max: b.targeting.age_max,
        genders: b.targeting.genders.length ? b.targeting.genders : undefined,
        flexible_spec: b.targeting.interests.length
          ? [{ interests: b.targeting.interests.map(i => ({ id: i.id, name: i.name })) }]
          : undefined,
      }),
    };
    if (b.daily_budget_cents) adsetParams.daily_budget = String(b.daily_budget_cents);
    if (b.lifetime_budget_cents) adsetParams.lifetime_budget = String(b.lifetime_budget_cents);
    if (b.start_at) adsetParams.start_time = b.start_at;
    if (b.end_at) adsetParams.end_time = b.end_at;

    const adset = await metaFetch(`${META_GRAPH}/${acctId}/adsets`, {
      method: 'POST', body: new URLSearchParams(adsetParams),
    });
    if (!adset.ok) return await fail(humanizeMetaError(adset.json));
    const metaAdsetId = adset.json.id;

    // 3. Create Creative
    const objectStorySpec: any = {
      page_id: cred.page_id,
      link_data: {
        message: b.creative.message,
        link: b.creative.link || `https://facebook.com/${cred.page_id}`,
        ...(b.creative.call_to_action ? { call_to_action: { type: b.creative.call_to_action } } : {}),
        ...(b.creative.image_hash ? { image_hash: b.creative.image_hash } : {}),
        ...(b.creative.image_url && !b.creative.image_hash ? { picture: b.creative.image_url } : {}),
      },
    };
    const creative = await metaFetch(`${META_GRAPH}/${acctId}/adcreatives`, {
      method: 'POST',
      body: new URLSearchParams({
        name: `${b.name} – Creative`,
        object_story_spec: JSON.stringify(objectStorySpec),
        access_token: token,
      }),
    });
    if (!creative.ok) return await fail(humanizeMetaError(creative.json));
    const metaCreativeId = creative.json.id;

    // 4. Create Ad
    const ad = await metaFetch(`${META_GRAPH}/${acctId}/ads`, {
      method: 'POST',
      body: new URLSearchParams({
        name: `${b.name} – Ad`,
        adset_id: metaAdsetId,
        creative: JSON.stringify({ creative_id: metaCreativeId }),
        status: targetStatus,
        access_token: token,
      }),
    });
    if (!ad.ok) return await fail(humanizeMetaError(ad.json));
    const metaAdId = ad.json.id;

    // 5. Optionally activate campaign + adset
    if (b.launch) {
      await metaFetch(`${META_GRAPH}/${metaCampaignId}`, {
        method: 'POST',
        body: new URLSearchParams({ status: 'ACTIVE', access_token: token }),
      });
      await metaFetch(`${META_GRAPH}/${metaAdsetId}`, {
        method: 'POST',
        body: new URLSearchParams({ status: 'ACTIVE', access_token: token }),
      });
    }

    const { data: updated } = await ctx.supabase
      .from('meta_ad_campaigns')
      .update({
        status: targetStatus,
        meta_campaign_id: metaCampaignId,
        meta_adset_id: metaAdsetId,
        meta_ad_id: metaAdId,
        meta_creative_id: metaCreativeId,
        last_error: null,
      })
      .eq('id', localCampaign.id)
      .select()
      .single();

    await logAudit(ctx.supabase, b.company_id, localCampaign.id, ctx.userId, b.launch ? 'launch' : 'create_draft', null, updated);

    return new Response(JSON.stringify({ success: true, campaign: updated }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal error';
    console.error('[meta-ads-launch]', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
