// optimize-posting — best-time-to-post + audience insights.
// Analyses a company's own published content to recommend when to post and
// to surface engagement insights. Currently uses sensible defaults + the
// playbook best-time; it reads recent published posts to refine as data grows.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { authenticate, corsHeaders } from "../_shared/meta-ads.ts";
import { bestTimeToPost } from "../_shared/marketing.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const { supabase } = auth;

  try {
    const body = await req.json().catch(() => ({}));
    const companyId = String(body.company_id || "");
    if (!companyId) return new Response(JSON.stringify({ error: "company_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: company } = await supabase.from("companies").select("name, business_type").eq("id", companyId).maybeSingle();

    // Recent published posts (engagement proxy when metrics are stored).
    const { data: posts } = await supabase
      .from("scheduled_posts").select("content, scheduled_time, status, image_url, video_url")
      .eq("company_id", companyId).eq("status", "published")
      .order("scheduled_time", { ascending: false }).limit(20);

    const published = posts || [];
    const best = bestTimeToPost(company);
    const insights = {
      best_time: best,
      published_count: published.length,
      channels_used: Array.from(new Set(published.map((p: any) => p.video_url ? "video" : (p.image_url ? "image" : "text")))),
      advice: published.length >= 3
        ? "You're posting consistently — keep a steady cadence and test the recommended times."
        : "Post more often to build momentum; aim for at least 3 posts this week.",
    };

    return new Response(JSON.stringify({ insights, company: company?.name || null }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[OPTIMIZE-POSTING] fatal:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
