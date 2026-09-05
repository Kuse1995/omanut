// growth-hub — Growth Engine scoreboard.
// Aggregates the company's full marketing funnel into one snapshot +
// generates a short AI weekly summary. Serves the Growth tab in the UI.
//
// Actions:
//   summary  -> compute aggregate metrics + AI narrative
//   snapshot -> upsert today's aggregate into growth_snapshots
//   history  -> last 30 daily snapshots (trend)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { authenticate, corsHeaders } from "../_shared/meta-ads.ts";
import { generateGrowthSummary } from "../_shared/marketing.ts";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const { supabase } = auth;

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "summary");
    const companyId = String(body.company_id || "");
    if (!companyId) return new Response(JSON.stringify({ error: "company_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: company } = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle();
    const since = new Date(Date.now() - WEEK_MS).toISOString();

    // Aggregates (all scoped to company + within the last 7 days).
    const [
      postsRes, videosRes, convRes, msgsRes, inboundRes, bmsRes, docsRes, payRes,
    ] = await Promise.all([
      supabase.from("scheduled_posts").select("status, meta_post_id, content").eq("company_id", companyId).gte("created_at", since),
      supabase.from("generated_images").select("id").eq("company_id", companyId).gte("created_at", since),
      supabase.from("conversations").select("id").eq("company_id", companyId).gte("created_at", since),
      supabase.from("messages").select("role, content").eq("company_id", companyId).gte("created_at", since),
      supabase.from("inbound_events").select("id, event_type, status").eq("company_id", companyId).gte("created_at", since),
      supabase.from("bms_connections").select("last_kb_text").eq("company_id", companyId).eq("is_active", true).maybeSingle(),
      supabase.from("company_documents").select("id, parsed_content").eq("company_id", companyId).limit(50),
      supabase.from("payment_transactions").select("amount, payment_status").eq("company_id", companyId).gte("created_at", since),
    ]);

    const posts = postsRes.data || [];
    const published = posts.filter((p: any) => p.status === "published").length;
    const pending = posts.filter((p: any) => p.status === "pending_approval").length;
    const failed = posts.filter((p: any) => p.status === "failed").length;
    const videos = (videosRes.data || []).length;
    const conversations = (convRes.data || []).length;
    const messages = msgsRes.data || [];
    const agentReplies = messages.filter((m: any) => m.role === "assistant").length;
    const inbound = inboundRes.data || [];
    const handled = inbound.filter((e: any) => e.status === "handled" || e.status === "answered").length;
    const unanswered = inbound.length - handled;
    const docs = (docsRes.data || []).length;
    // KB grounding coverage: docs with parsed content
    const kbDocs = (docsRes.data || []).filter((d: any) => d.parsed_content).length;
    const bmsCatalog = !!(bmsRes.data?.last_kb_text);

    // Campaign + variant totals
    const { data: campaigns } = await supabase.from("campaigns").select("id, status").eq("company_id", companyId);
    const campaignTotal = (campaigns || []).length;
    const runningCampaigns = (campaigns || []).filter((c: any) => c.status === "running").length;

    // Lead funnel
    const leads = inbound.filter((e: any) => /lead|enquir|price|quote|book|order|buy/i.test(String(e.event_type || "") + " " + String(e.payload || ""))).length;

    // Revenue attribution — completed payment transactions this week.
    const paid = (payRes.data || []).filter((t: any) => /paid|success|completed/i.test(String(t.payment_status || "")));
    const revenue = paid.reduce((sum: number, t: any) => sum + (Number(t.amount) || 0), 0);
    const transactions = paid.length;

    const metrics = {
      company: company?.name || "your business",
      period: "last 7 days",
      posts_published: published,
      posts_pending: pending,
      posts_failed: failed,
      videos_generated: videos,
      conversations: conversations,
      agent_replies: agentReplies,
      leads: leads,
      inbound_events: inbound.length,
      answered: handled,
      unanswered_missed: Math.max(0, unanswered),
      campaigns_total: campaignTotal,
      campaigns_running: runningCampaigns,
      kb_documents: docs,
      kb_grounded_docs: kbDocs,
      bms_catalog: bmsCatalog,
      revenue,
      transactions,
    };

    let summary = "";
    let narrative = "";
    if (action === "summary" || action === "snapshot") {
      narrative = await generateGrowthSummary(company?.name || "your business", metrics);
      summary = narrative;
    }

    if (action === "snapshot") {
      const today = new Date().toISOString().slice(0, 10);
      await supabase
        .from("growth_snapshots")
        .upsert(
          { company_id: companyId, snapshot_date: today, metrics },
          { onConflict: "company_id,snapshot_date" },
        );
    }

    if (action === "history") {
      const { data: history } = await supabase
        .from("growth_snapshots").select("snapshot_date, metrics").eq("company_id", companyId)
        .order("snapshot_date", { ascending: false }).limit(30);
      return new Response(JSON.stringify({ history: history || [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ metrics, summary, narrative }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[GROWTH-HUB] fatal:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
