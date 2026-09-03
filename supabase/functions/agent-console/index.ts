// agent-console — the AaaS customer surface: a ChatGPT-style agent backed by
// the Company Brain. One chat, routed to capabilities:
//   - knowledge/pricing questions -> answered from company facts
//   - "make a video ad about X"   -> omanut-motion (Seedance render)
//   - "draft a post about Y"      -> scheduled_posts (pending_approval)
//
// Auth: user JWT required (the UI calls this via supabase.functions.invoke,
// which attaches the session). Membership verified against company_users
// (global admins allowed). RLS-safe multi-tenancy.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { harnessChatWithFallback } from "../_shared/harness-client.ts";
import { buildCompanyFacts } from "../_shared/company-context.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authorization required" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const user = userData.user;

    const { company_id, message, history, image_urls } = await req.json().catch(() => ({}));
    const refs: string[] = Array.isArray(image_urls) ? image_urls.filter((u: any) => !!u).slice(0, 4) : [];
    if (!company_id || !message || !String(message).trim()) {
      return new Response(JSON.stringify({ error: "company_id and message are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Membership (global admins allowed — mirrors meta-oauth-exchange).
    const { data: membership } = await supabase
      .from("company_users")
      .select("company_id")
      .eq("user_id", user.id)
      .eq("company_id", company_id)
      .maybeSingle();
    if (!membership) {
      const { data: adminRole } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (!adminRole) {
        return new Response(JSON.stringify({ error: "No access to this company" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const { data: company } = await supabase
      .from("companies")
      .select("id, name, metadata, voice_style, hours, services, quick_reference_info")
      .eq("id", company_id)
      .maybeSingle();
    if (!company) {
      return new Response(JSON.stringify({ error: "Company not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const facts = buildCompanyFacts(company);
    const historyMsgs = (Array.isArray(history) ? history : [])
      .slice(-8)
      .map((h: any) => ({ role: h.role === "user" ? "user" : "assistant", content: String(h.content || "").slice(0, 500) }));

    const system = [
      "You are the AI agent for " + (company.name || "this business") + " — the owner is chatting with you in their console.",
      facts ? facts : "",
      "",
      "CAPABILITIES:",
      "1. Answer questions about the business from the FACTS above (pricing, hours, services).",
      "2. Create video ads — if the user wants a video/ad/reel, begin your reply with exactly \"VIDEO:\" followed by a one-sentence cinematic brief (nothing else after describing it).",
      "3. Draft social posts — if the user wants a post drafted, begin your reply with exactly \"POST:\" followed by the ready-to-publish caption (nothing else).",
      "Otherwise answer normally from the FACTS: warm, concise (1-5 short lines), no markdown, no invented prices or claims.",
    ].filter(Boolean).join("\n");

    // GLM failures (rate limits, cold latency) are bursty — one retry after
    // a short backoff recovers most of them without bothering the user.
    const agentMessages = [{ role: "system", content: system }, ...historyMsgs, { role: "user", content: String(message) }];
    const harnessOpts = { companyId: company_id, metadata: company?.metadata || null, mode: "content" as const };
    let result = await harnessChatWithFallback(agentMessages, [], harnessOpts);
    if (!result.ok) {
      await new Promise((r) => setTimeout(r, 3000));
      result = await harnessChatWithFallback(agentMessages, [], harnessOpts);
    }
    let reply = result.ok && result.message?.content ? String(result.message.content).trim() : "I couldn't process that just now — please try again.";
    let action: any = { type: null };
    // Diagnostic: surface WHY the harness fell back (timeout / rate limit /
    // not_configured) so failures are visible in the client's network tab
    // instead of a silent generic error.
    const harness_reason = result.ok ? null : (result.reason || "harness_error");

    // Route tool escapes.
    if (reply.toUpperCase().startsWith("VIDEO:")) {
      const brief = reply.slice(6).trim() || String(message);
      // A long, scene-structured message (or one with reference images)
      // passes through verbatim as the video script — the caller already
      // did the creative direction. Sub-agents are skipped.
      const looksLikeScript = refs.length > 0 && message.length > 400;
      const motionBody: Record<string, unknown> = looksLikeScript
        ? { company_id, brief: message.slice(0, 200), script_override: message, image_urls: refs }
        : { company_id, brief, image_urls: refs };
      const motionRes: any = await supabase.functions.invoke("omanut-motion", {
        body: motionBody,
      });
      if (motionRes?.error) {
        console.error("[AGENT-CONSOLE] omanut-motion failed:", motionRes.error);
        reply = "I couldn't start the video render just now — please try again in a moment.";
      } else {
        reply = "🎬 Video render started. It takes 1-3 minutes — the finished video lands in your Media Studio and I'll let you know here.";
        action = { type: "video", job_id: motionRes.data?.job_id ?? null, brief };
      }
    } else if (reply.toUpperCase().startsWith("POST:")) {
      const caption = reply.slice(5).trim();
      const { data: cred } = await supabase
        .from("meta_credentials")
        .select("page_id")
        .eq("company_id", company_id)
        .limit(1)
        .maybeSingle();
      if (!cred?.page_id) {
        reply = "I can draft posts, but no Facebook page is connected yet — connect one under Meta Integrations first.";
      } else {
        const { data: post, error: postErr } = await supabase
          .from("scheduled_posts")
          .insert({
            company_id,
            page_id: cred.page_id,
            content: caption,
            target_platform: "facebook",
            scheduled_time: new Date(Date.now() + 3600000).toISOString(),
            status: "pending_approval",
            created_by: user.id,
          })
          .select("id")
          .single();
        if (postErr) {
          console.error("[AGENT-CONSOLE] post insert failed:", postErr);
          reply = "The draft failed to save — please try again.";
        } else {
          reply = "📝 Post drafted and saved for your approval in the Content Scheduler:\n\n" + caption;
          action = { type: "post", post_id: post?.id ?? null };
        }
      }
    }

    return new Response(JSON.stringify({ reply, action, harness_reason }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[AGENT-CONSOLE] fatal:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});