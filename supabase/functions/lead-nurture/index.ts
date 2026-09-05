// lead-nurture — proactive follow-up sequences.
// Turns a captured lead (or an event trigger) into scheduled follow-up posts
// so nothing falls through the cracks. Sequences are stored per-company with
// an ordered set of steps (delay + message); this function materialises the
// next pending step into the Content Scheduler.
//
// Actions:
//   list            -> list the company's sequences
//   create          -> upsert a sequence            { name, trigger_type, steps:[{delay_days, message, media_url}] }
//   arm             -> schedule the next pending step for a trigger event { sequence_id, trigger_key, source }
//   disarm          -> cancel pending nurture posts for a trigger

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { authenticate, corsHeaders } from "../_shared/meta-ads.ts";

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
      const { data: sequences } = await supabase.from("nurture_sequences").select("*").eq("company_id", companyId).order("created_at", { ascending: false });
      return new Response(JSON.stringify({ sequences: sequences || [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "create") {
      const name = String(body.name || "").trim();
      if (!name) return new Response(JSON.stringify({ error: "name is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const steps = Array.isArray(body.steps) ? body.steps.map((s: any) => ({
        delay_days: Number(s.delay_days || 0),
        channel: String(s.channel || "facebook").toLowerCase(),
        message: String(s.message || "").trim(),
        media_url: String(s.media_url || "").trim() || null,
      })).filter((s: any) => s.message) : [];
      if (!steps.length) return new Response(JSON.stringify({ error: "steps with messages are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const { data: seq, error: sErr } = await supabase
        .from("nurture_sequences")
        .insert({ company_id: companyId, name, trigger_type: String(body.trigger_type || "custom").slice(0, 60), steps, enabled: body.enabled !== false })
        .select("id")
        .single();
      if (sErr) throw sErr;
      return new Response(JSON.stringify({ success: true, sequence_id: seq.id, steps }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "arm") {
      const seqId = String(body.sequence_id || "");
      const triggerKey = String(body.trigger_key || body.source || "lead");
      const { data: seq } = await supabase.from("nurture_sequences").select("*").eq("id", seqId).eq("company_id", companyId).maybeSingle();
      if (!seq) return new Response(JSON.stringify({ error: "Sequence not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: cred } = await supabase.from("meta_credentials").select("page_id").eq("company_id", companyId).limit(1).maybeSingle();
      if (!cred?.page_id) return new Response(JSON.stringify({ error: "No connected page" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      let scheduled = 0;
      for (const step of seq.steps || []) {
        const scheduledTime = new Date(Date.now() + (Number(step.delay_days || 0) + 1) * 24 * 60 * 60 * 1000).toISOString();
        const { error: pErr } = await supabase.from("scheduled_posts").insert({
          company_id: companyId,
          page_id: cred.page_id,
          content: step.message,
          scheduled_time: scheduledTime,
          status: "pending_approval",
          created_by: body.user_id || auth.userId || null,
          image_url: step.media_url && step.channel !== "video" ? step.media_url : null,
          video_url: step.channel === "video" ? step.media_url : null,
          target_platform: step.channel === "instagram" ? "instagram" : "facebook",
        });
        if (!pErr) scheduled++;
      }
      return new Response(JSON.stringify({ success: true, scheduled: scheduled, sequence_id: seqId, trigger_key: triggerKey }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "disarm") {
      const triggerKey = String(body.trigger_key || "");
      // Cancel pending follow-up posts we may have scheduled (best-effort).
      const { error } = await supabase.from("scheduled_posts").update({ status: "failed", error_message: "Nurture disarmed" }).eq("company_id", companyId).eq("status", "pending_approval").ilike("content", "%" + triggerKey + "%");
      return new Response(JSON.stringify({ success: true, disarmed: triggerKey, ignored: !!error }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[LEAD-NURTURE] fatal:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
