// Omanut Motion — brand-grounded AI video generation for tenants.
//
// POST { company_id, brief, aspect_ratio?, resolution?, duration?, input_image_url? }
//
// Flow (the "own Higgsfield" play — models called directly, no middleman):
//   1. Harness (GLM-5.3-Flash) turns the marketer's brief into ONE cinematic
//      Seedance prompt, grounded in company facts (services, voice).
//   2. Submits to fal.ai's queue API (Seedance v1 Pro; text-to-video or
//      image-to-video with a brand product shot).
//   3. Inserts a video_generation_jobs row (provider='seedance',
//      operation_name = fal request_id) so poll-video-generation owns the
//      lifecycle: poll -> download -> storage -> WhatsApp the boss.
//
// Auth: requires Authorization: Bearer <CRON_SECRET> when CRON_SECRET is set
// (same pattern as the other watchdogs); callers are platform-internal.
//
// Cost note: Seedance v1 Pro on fal is ~$0.62 per 1080p 5s video, ~$0.28 at
// 720p. Default here is 720p (draft quality) — spend lives in the tenant's
// existing credit accounting.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { harnessChatWithFallback } from "../_shared/harness-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FAL_QUEUE_BASE = "https://queue.fal.run";
const FAL_TEXT_MODEL = "fal-ai/bytedance/seedance/v1/pro/text-to-video";
const FAL_IMAGE_MODEL = "fal-ai/bytedance/seedance/v1/pro/image-to-video";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== "Bearer " + cronSecret) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });
    }
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const body = await req.json().catch(() => ({}));
    const {
      company_id,
      brief,
      aspect_ratio = "9:16",
      resolution = "720p",
      duration = "5",
      input_image_url = null,
    } = body ?? {};

    if (!company_id || !brief || !String(brief).trim()) {
      return new Response(JSON.stringify({ error: "company_id and brief are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const FAL_KEY = Deno.env.get("FAL_KEY");
    if (!FAL_KEY) {
      return new Response(JSON.stringify({ error: "FAL_KEY not configured on the project" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: company } = await supabase
      .from("companies")
      .select("id, name, metadata, voice_style, services, whatsapp_number")
      .eq("id", company_id)
      .maybeSingle();
    if (!company) {
      return new Response(JSON.stringify({ error: "Company not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Boss phone (NOT NULL on the job row): boss list first, WhatsApp number fallback.
    let bossPhone = "";
    const { data: bossRow } = await supabase
      .from("company_boss_phones")
      .select("phone")
      .eq("company_id", company_id)
      .limit(1)
      .maybeSingle();
    if (bossRow?.phone) {
      bossPhone = bossRow.phone.startsWith("whatsapp:") ? bossRow.phone : "whatsapp:" + bossRow.phone;
    } else if (company.whatsapp_number) {
      bossPhone = company.whatsapp_number.startsWith("whatsapp:") ? company.whatsapp_number : "whatsapp:" + company.whatsapp_number;
    }
    if (!bossPhone) {
      return new Response(JSON.stringify({ error: "No boss phone or WhatsApp number on file for this company" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1) Harness writes the cinematic prompt (grounded in company facts).
    const facts = [
      company.voice_style ? "BRAND VOICE: " + company.voice_style : "",
      company.services ? "PRODUCTS/SERVICES: " + company.services : "",
    ].filter(Boolean).join("\n");
    const harnessResult = await harnessChatWithFallback(
      [
        {
          role: "system",
          content: "You convert a marketer's brief into ONE self-contained cinematic video-generation prompt for the Seedance text-to-video model. Output ONLY the prompt — a single vivid paragraph describing subject, action, camera movement, lighting, setting and mood. No markdown, no lists, no preamble, no quotes around it. If the brief mentions a product, feature it as the hero. Never include text overlays or spoken words."
            + (facts ? "\n" + facts : ""),
        },
        { role: "user", content: String(brief) },
      ],
      [],
      { companyId: company_id, metadata: company?.metadata || null, mode: "content" }
    );
    const falPrompt = harnessResult.ok && harnessResult.message?.content
      ? String(harnessResult.message.content).trim().slice(0, 1500)
      : String(brief).trim();

    // 2) Submit to the fal.ai queue.
    const model = input_image_url ? FAL_IMAGE_MODEL : FAL_TEXT_MODEL;
    const submitBody: Record<string, unknown> = {
      prompt: falPrompt,
      aspect_ratio,
      resolution,
      duration,
    };
    if (input_image_url) submitBody.image_url = input_image_url;

    const submitRes = await fetch(FAL_QUEUE_BASE + "/" + model, {
      method: "POST",
      headers: {
        Authorization: "Key " + FAL_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(submitBody),
    });
    const submitJson: any = await submitRes.json().catch(() => ({}));
    if (!submitRes.ok || !submitJson.request_id) {
      console.error("[OMANUT-MOTION] fal submit failed:", submitRes.status, submitJson);
      return new Response(JSON.stringify({ error: "fal submit failed", details: submitJson }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3) Job row — poll-video-generation owns the lifecycle from here.
    const { data: job, error: jobErr } = await supabase
      .from("video_generation_jobs")
      .insert({
        company_id,
        operation_name: submitJson.request_id,
        status: "pending",
        prompt: falPrompt,
        aspect_ratio,
        boss_phone: bossPhone,
        video_provider: "seedance",
        scheduled_post_data: {
          surface: "omanut_motion",
          brief,
          model,
          input_image_url,
          fal_status_url: submitJson.status_url ?? null,
          resolution,
          duration,
        },
      })
      .select("id")
      .single();
    if (jobErr || !job) {
      return new Response(JSON.stringify({ error: "Job insert failed", details: jobErr?.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Kick the first poll immediately (cron keeps it going afterwards).
    await supabase.functions.invoke("poll-video-generation", { body: {} });

    return new Response(
      JSON.stringify({
        job_id: job.id,
        fal_request_id: submitJson.request_id,
        provider: "seedance",
        prompt: falPrompt,
        status: "pending",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[OMANUT-MOTION] fatal:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});