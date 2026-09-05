// campaign-engine — Grow Engine orchestration.
// Creates a campaign with 2-3 on-brand A/B creative variants, schedules each
// as a pending_approval post (so they flow through the Content Scheduler /
// publish-meta-post), tracks their metrics, computes a composite score, and
// can select + promote the winner.
//
// Actions:
//   create   -> make variants + schedule posts          { brief, playbook, name, objective, target_platform, channels, image_url, video_url }
//   list     -> list campaigns + variants               {}
//   get      -> one campaign with variants               { campaign_id }
//   track    -> recompute scores from scheduled_post metrics { campaign_id }
//   promote  -> mark a variant winner                    { campaign_id, variant_id }
//
// Auth: user JWT or service role (meta-ads.authenticate).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { authenticate, corsHeaders } from "../_shared/meta-ads.ts";
import { getPlaybook, buildBrandBlock, generateVariants } from "../_shared/marketing.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const { supabase } = auth;

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "create");
    const companyId = String(body.company_id || "");
    if (!companyId) {
      return new Response(JSON.stringify({ error: "company_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── LIST ──────────────────────────────────────────────────────────
    if (action === "list") {
      const { data: campaigns } = await supabase
        .from("campaigns").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(30);
      const ids = (campaigns || []).map((c: any) => c.id);
      let variants: any[] = [];
      if (ids.length) {
        const { data: v } = await supabase.from("campaign_variants").select("*").in("campaign_id", ids).order("created_at", { ascending: true });
        variants = v || [];
      }
      const enriched = (campaigns || []).map((c: any) => ({ ...c, variants: variants.filter((x) => x.campaign_id === c.id) }));
      return new Response(JSON.stringify({ campaigns: enriched }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── GET ───────────────────────────────────────────────────────────
    if (action === "get") {
      const campaignId = String(body.campaign_id || "");
      const { data: campaign } = await supabase.from("campaigns").select("*").eq("id", campaignId).eq("company_id", companyId).maybeSingle();
      if (!campaign) return new Response(JSON.stringify({ error: "Campaign not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: variants } = await supabase.from("campaign_variants").select("*").eq("campaign_id", campaignId).order("created_at", { ascending: true });
      return new Response(JSON.stringify({ campaign, variants: variants || [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── CREATE ────────────────────────────────────────────────────────
    if (action === "create") {
      const brief = String(body.brief || "").trim();
      if (!brief) return new Response(JSON.stringify({ error: "brief is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const template = getPlaybook(String(body.playbook || ""));
      const channels: string[] = Array.isArray(body.channels) && body.channels.length ? body.channels.map(String) : ["facebook", "instagram"];
      const count = Math.max(2, Math.min(4, Number(body.variant_count) || 3));

      // Brand kit for on-brand content
      const { data: kit } = await supabase.from("brand_kits").select("*").eq("company_id", companyId).maybeSingle();
      const brandBlock = buildBrandBlock(kit);

      const variants = await generateVariants({ brief, brandBlock, template, count, channels });
      const mediaUrl = String(body.image_url || "").trim() || null;
      const mediaType = String(body.media_type || "").trim().toLowerCase();

      // Default page for posting
      const { data: cred } = await supabase
        .from("meta_credentials").select("page_id").eq("company_id", companyId).limit(1).maybeSingle();
      if (!cred?.page_id) {
        return new Response(JSON.stringify({ error: "No Facebook page connected. Say \"connect\" in the agent chat first." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const createdBy = auth.isServiceRole ? body.user_id || null : auth.userId || null;

      const { data: campaign, error: cErr } = await supabase
        .from("campaigns")
        .insert({
          company_id: companyId,
          name: String(body.name || template.label + " — " + brief.slice(0, 40)).slice(0, 140),
          objective: String(body.objective || template.objective).slice(0, 140),
          brief: brief.slice(0, 2000),
          playbook: template.key,
          target_platform: String(body.target_platform || "both"),
          status: "draft",
          scheduled_time: body.scheduled_time ? new Date(body.scheduled_time).toISOString() : null,
          target_audience: String(body.target_audience || "").slice(0, 300) || null,
          funnel_stage: template.funnelStage,
          created_by: createdBy,
        })
        .select("id")
        .single();
      if (cErr) throw cErr;

      const links: any[] = [];
      for (const v of variants) {
        // Schedule each variant as a pending_approval post.
        const { data: post, error: pErr } = await supabase
          .from("scheduled_posts")
          .insert({
            company_id: companyId,
            page_id: cred.page_id,
            content: v.content,
            scheduled_time: new Date(Date.now() + 3600000).toISOString(),
            status: "pending_approval",
            created_by: createdBy,
            image_url: mediaType === "image" ? mediaUrl : null,
            video_url: mediaType === "video" ? mediaUrl : null,
          })
          .select("id")
          .single();
        if (pErr) throw pErr;
        const { data: variant, error: vErr } = await supabase
          .from("campaign_variants")
          .insert({
            campaign_id: campaign.id,
            company_id: companyId,
            label: v.label,
            content: v.content,
            hook: v.hook,
            image_url: mediaType === "image" ? mediaUrl : null,
            video_url: mediaType === "video" ? mediaUrl : null,
            channel: v.channel,
            status: "scheduled",
            post_id: post?.id ?? null,
          })
          .select("id")
          .single();
        if (vErr) throw vErr;
        links.push({ variant_id: variant.id, post_id: post?.id ?? null, label: v.label, channel: v.channel });
      }

      await supabase.from("campaigns").update({ status: "running" }).eq("id", campaign.id);

      return new Response(JSON.stringify({ success: true, campaign_id: campaign.id, variants: links }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── TRACK ─────────────────────────────────────────────────────────
    if (action === "track") {
      const campaignId = String(body.campaign_id || "");
      const { data: campaign } = await supabase.from("campaigns").select("*").eq("id", campaignId).eq("company_id", companyId).maybeSingle();
      if (!campaign) return new Response(JSON.stringify({ error: "Campaign not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: rawVariants } = await supabase.from("campaign_variants").select("*").eq("campaign_id", campaignId);
      const variants = rawVariants || [];
      // Pull live metrics from the linked scheduled posts (engagement counts as they come in).
      const postIds = variants.map((v) => v.post_id).filter(Boolean);
      let posts: any[] = [];
      if (postIds.length) {
        const { data: p } = await supabase.from("scheduled_posts").select("id, meta_post_id, status").in("id", postIds);
        posts = p || [];
      }
      const postById = new Map(posts.map((p) => [p.id, p]));
      const scored = variants.map((v: any) => {
        const m = v.metrics || {};
        const impressions = Number(m.impressions || 0);
        const reach = Number(m.reach || 0);
        const likes = Number(m.likes || 0);
        const comments = Number(m.comments || 0);
        const shares = Number(m.shares || 0);
        const clicks = Number(m.clicks || 0);
        const leads = Number(m.leads || 0);
        const revenue = Number(m.revenue || 0);
        const engagement = likes + comments + shares;
        const rate = reach > 0 ? engagement / reach : 0;
        // Composite: engagement rate (50), clicks (20), leads (20), revenue (10)
        const score = Math.round((Math.min(rate * 100, 1) * 50) + (clicks > 0 ? Math.min(clicks, 50) : 0) + (leads * 20) + (revenue > 0 ? 10 : 0));
        const metaId = postById.get(v.post_id)?.meta_post_id || null;
        return { ...v, score: Math.min(100, score), meta_post_id: metaId };
      });
      for (const s of scored) {
        await supabase.from("campaign_variants").update({ score: s.score, status: s.status }).eq("id", s.id);
      }
      const best = scored.reduce((a, b) => (b.score > a.score ? b : a), scored[0]);
      return new Response(JSON.stringify({ campaign: campaign.id, variants: scored, leading_variant_id: best?.id || null, leading_score: best?.score || 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── PROMOTE ───────────────────────────────────────────────────────
    if (action === "promote") {
      const campaignId = String(body.campaign_id || "");
      const variantId = String(body.variant_id || "");
      if (!variantId) return new Response(JSON.stringify({ error: "variant_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      await supabase.from("campaign_variants").update({ is_winner: false }).eq("campaign_id", campaignId);
      const { error: uErr } = await supabase.from("campaign_variants").update({ is_winner: true }).eq("id", variantId);
      if (uErr) throw uErr;
      await supabase.from("campaigns").update({ winner_variant_id: variantId, status: "completed" }).eq("id", campaignId);
      return new Response(JSON.stringify({ success: true, winner_variant_id: variantId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[CAMPAIGN-ENGINE] fatal:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
