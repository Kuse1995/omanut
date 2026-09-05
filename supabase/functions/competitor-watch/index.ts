// competitor-watch — market/competitor monitoring.
// Manages the list of competitor pages/hashtags a company watches, and
// surfaces a lightweight market insight. Live Graph scraping is gated so we
// degrade gracefully when credentials aren't present.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { authenticate, corsHeaders } from "../_shared/meta-ads.ts";
import { geminiChatWithFallback, PRIMARY_TEXT_MODEL } from "../_shared/gemini-client.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const { supabase } = auth;

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "list");
    const companyId = String(body.company_id || "");
    if (!companyId) return new Response(JSON.stringify({ error: "company_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    if (action === "list") {
      const { data: targets } = await supabase.from("competitor_targets").select("*").eq("company_id", companyId).order("created_at", { ascending: false });
      return new Response(JSON.stringify({ targets: targets || [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "add") {
      const name = String(body.name || "").trim();
      if (!name) return new Response(JSON.stringify({ error: "name is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: t, error } = await supabase.from("competitor_targets").insert({
        company_id: companyId,
        name,
        platform: String(body.platform || "facebook").slice(0, 30),
        identifier: String(body.identifier || name).slice(0, 200),
      }).select("id").single();
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, id: t.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "remove") {
      const id = String(body.id || "");
      const { error } = await supabase.from("competitor_targets").delete().eq("id", id).eq("company_id", companyId);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "insight") {
      const { data: targets } = await supabase.from("competitor_targets").select("*").eq("company_id", companyId).eq("enabled", true).limit(10);
      const list = targets || [];
      const note = list.length
        ? "We are watching: " + list.map((t: any) => t.name).join(", ") + ". Use these to differentiate your own posts."
        : "No competitors tracked yet. Add a few to get market positioning insights.";
      let summary = note;
      try {
        const ai = await geminiChatWithFallback({
          model: PRIMARY_TEXT_MODEL,
          messages: [
            { role: "system", content: "You are a social media strategist. In 2-3 short plain-text sentences, advise a small business on how to stand out versus the competitors listed. No markdown, no bullets." },
            { role: "user", content: note },
          ],
          temperature: 0.4,
          max_tokens: 300,
        });
        const d: any = await ai.json().catch(() => ({}));
        summary = String(d?.choices?.[0]?.message?.content || note).trim();
      } catch { /* fall back to note */ }
      return new Response(JSON.stringify({ insight: summary, targets: list }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[COMPETITOR-WATCH] fatal:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
