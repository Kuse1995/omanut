// Omanut Motion v2 — multi-sub-agent video pipeline ("our own Higgsfield").
//
// Workflow adapted from NatiDvir/video-skills (MIT) — the Script Writer /
// Director / Generator role structure demonstrated with Higgsfield MCP:
//   Stage 1  MARKETING (Script Writer): brief + company facts -> style lock,
//            2-second hook, beat timeline, CTA.
//   Stage 2  CREATIVE DIRECTOR: beat plan -> shot-by-shot plan (camera,
//            lighting, action) with a production-ready Seedance prompt per
//            shot, and a designated HERO shot.
//   Stage 3  GENERATOR: renders the hero shot via fal.ai (Seedance v1 Pro,
//            queue API); the full shot plan is stored on the job so extra
//            shots can be rendered on approval (preview -> hero).
//
// POST { company_id, brief, aspect_ratio?, resolution?, duration?, input_image_url? }
// Auth: Authorization: Bearer <CRON_SECRET> when CRON_SECRET is set.
//
// Cost: Seedance v1 Pro ~$0.62/1080p-5s, ~$0.28/720p-5s, ~$0.12/480p-5s.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { harnessChatWithFallback } from "../_shared/harness-client.ts";
import { buildBrandBlock } from "../_shared/marketing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── THE STYLE ENGINE ────────────────────────────────────────────────────
// The 6 motion-design styles companies pay $300-$3,000 for (the own-
// Higgsfield menu). Each entry is production direction: visual language,
// camera/motion vocabulary, pacing, and Seedance-specific guidance. GLM-5.3
// (Stage 1) locks the style; the Director (Stage 2) obeys its cinematography.
const MOTION_STYLES: Record<string, { label: string; direction: string }> = {
  saas_launch: {
    label: "SaaS launch video",
    direction: "Product-as-hero. Motion built around UI: dashboard glows, cursor moves, card slides, metric count-ups, clean dark or light surfaces with generous negative space. Camera: subtle push-ins and precise lateral slides, never handheld. Pacing: confident, 2-second beats, one feature per beat. Seedance: clean geometric motion, crisp light sweeps across screens, no clutter.",
  },
  real_footage_motion: {
    label: "Motion on top of real footage",
    direction: "Live-action base with graphics layered on: tracking overlays, kinetic captions, arrows and callouts pinned to moving subjects, price tags popping on products. Camera: match the documentary feel of the base plate, natural sway allowed. Pacing: punchy, beat-synced pops. Seedance: when an input frame from real footage is attached, extend ITS motion and perspective; keep the plate stable and let the drama come from what appears over it.",
  },
  hypermotion_product: {
    label: "Hypermotion product ad",
    direction: "Extreme macro product worship. Dramatic lighting sweeps, speed-ramped spins, droplet and particle bursts, slow-mo luxury into snap stops. Camera: orbit, whip to macro, crash-zoom on the hero detail. Pacing: high contrast, slow moments then explosive transitions. Seedance: glossy surfaces, specular highlights, shallow depth of field, premium commercial finish.",
  },
  flythrough_3d: {
    label: "3D flythrough",
    direction: "Architectural and spatial flythroughs: continuous gimbal glides through rooms and structures, reveals through doorways and around corners, dawn or dusk light through windows, scale plays between intimate and grand. Camera: one continuous motivated move per shot, glide, orbit a volume, rise to a wide view. Pacing: smooth, unhurried, prestige. Seedance: consistent spatial logic between shots, volumetric light, no cuts mid-glide.",
  },
  explainer_2d: {
    label: "2D explainer",
    direction: "Flat-vector illustration language: clean shapes, limited palette, icon transitions, characters with simple gestures, background color shifts per beat. Camera: dynamic 2D framing, panels slide, elements pop with easing, wipe transitions. Pacing: friendly and clear, one idea per beat. Seedance: cohesive 2D world, crisp edges, playful but disciplined motion, no photoreal elements.",
  },
  editorial_explainer: {
    label: "Editorial explainer",
    direction: "Magazine-grade motion: kinetic serif headlines, paper and ink texture grain, refined grids, restrained color, elegant negative space, footage treated like editorial photography. Camera: deliberate drifts and print-inspired set moves. Pacing: measured, sophisticated, headline-first. Seedance: tactile textures, refined layout motion, understated but premium.",
  },
  cinematic: {
    label: "Cinematic (directors choice)",
    direction: "Full creative freedom with film discipline: motivated camera, naturalistic light, emotional pacing. Seedance: filmic grain, believable physics, one strong idea per shot.",
  },
};

const STYLE_KEYS = Object.keys(MOTION_STYLES);

const FAL_QUEUE_BASE = "https://queue.fal.run";
const FAL_TEXT_MODEL = "fal-ai/bytedance/seedance/v1/pro/text-to-video";
const FAL_IMAGE_MODEL = "fal-ai/bytedance/seedance/v1/pro/image-to-video";

function extractJson(text: string): any | null {
  if (!text) return null;
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* try braces */ }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
  }
  return null;
}

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
      // v2.5 additions: a full caller-written script is passed through
      // verbatim (skipping the sub-agents), plus multimodal reference
      // images (product packshots) for Seedance 2.5 reference-to-video.
      script_override = null,
      image_urls = null,
      model_choice = null,
      // Director-conversation modes: plan_only returns the shot plan WITHOUT
      // rendering; approved_plan renders a plan the owner already approved.
      plan_only = false,
      approved_plan = null,
    } = body ?? {};

    const refs: string[] = Array.isArray(image_urls) ? image_urls.filter((u: any) => !!u) : [];
    const useScript = script_override && String(script_override).trim().length > 0;
    if (!company_id || (!brief || !String(brief).trim()) && !useScript) {
      return new Response(JSON.stringify({ error: "company_id and brief are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const FAL_KEY = Deno.env.get("FAL_KEY");
    if (!FAL_KEY) {
      return new Response(JSON.stringify({ error: "FAL_KEY not configured on the project" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: company } = await supabase
      .from("companies")
      .select("id, name, metadata, voice_style, services, quick_reference_info, whatsapp_number, credit_balance")
      .eq("id", company_id)
      .maybeSingle();
    if (!company) {
      return new Response(JSON.stringify({ error: "Company not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── SPEND GUARDRAIL ────────────────────────────────────────────────
    // Every render costs tenant credits. Reject when the balance can't cover
    // it, and deduct atomically (a conditional update — if another render
    // raced us and drained the balance, the update matches no rows).
    const seconds = Math.max(1, Number(duration) || 5);
    const perSecond = resolution === "1080p" ? 0.124 : resolution === "480p" ? 0.024 : 0.056; // ≈ fal Seedance pricing
    const cost = Math.max(1, Math.ceil(seconds * perSecond * 10)); // 1 credit ≈ $0.10
    const balance = Number(company.credit_balance ?? 0);
    if (balance < cost) {
      return new Response(JSON.stringify({
        error: "Insufficient credits for this render",
        required_credits: cost,
        credit_balance: balance,
        hint: "Top up your plan or lower the resolution/duration.",
      }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: deducted, error: deductErr } = await supabase
      .from("companies")
      .update({ credit_balance: balance - cost })
      .eq("id", company_id)
      .gte("credit_balance", cost)
      .select("credit_balance")
      .maybeSingle();
    if (deductErr || !deducted) {
      return new Response(JSON.stringify({ error: "Insufficient credits for this render", required_credits: cost, credit_balance: balance }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const remainingCredits = Number(deducted.credit_balance ?? 0);
    console.log("[OMANUT-MOTION] spend guardrail: -" + cost + " credits, " + remainingCredits + " remaining");

    // Brand Kit — the on-brand guardrail for every video the agent makes.
    let brandBlock = "";
    try {
      const { data: kit } = await supabase.from("brand_kits").select("tone, colors, no_go_phrases, guidelines").eq("company_id", company_id).maybeSingle();
      brandBlock = buildBrandBlock(kit);
    } catch { /* brand kit is optional */ }

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

    const facts = [
      company.voice_style ? "BRAND VOICE: " + company.voice_style : "",
      company.services ? "PRODUCTS/SERVICES: " + company.services : "",
      company.quick_reference_info ? "QUICK FACTS: " + company.quick_reference_info : "",
    ].filter(Boolean).join("\n");

    // ── STAGE 1+2: MARKETING (Script Writer) + CREATIVE DIRECTOR ───────
    // When the caller supplies a full script (script_override), the user has
    // already done the creative work — it passes through verbatim and the
    // sub-agents are skipped. approved_plan is the Director-conversation
    // path: the owner already saw and approved this exact plan, so it is
    // applied verbatim — no new creative decisions are made here.
    let script: any = {
      style: "cinematic",
      hook: String(brief),
      beats: [String(brief)],
      cta: "",
    };
    let shots: any[] = [{
      n: 1,
      camera: "director's choice",
      lighting: "natural",
      action: useScript ? "(caller-supplied script)" : String(brief),
      seedance_prompt: useScript ? String(script_override).trim() : String(brief).trim(),
    }];
    let heroIdx = 0;

    // approved_plan (Director-conversation render): the owner already saw and
    // approved this exact plan — apply it verbatim, no new creative decisions.
    if (approved_plan && typeof approved_plan === "object" && !useScript) {
      try {
        const ap: any = approved_plan;
        if (ap.script) script = ap.script;
        if (Array.isArray(ap.shots) && ap.shots.length) shots = ap.shots;
        heroIdx = Math.min(Math.max(Number(ap.hero_shot) || 1, 1), shots.length) - 1;
        console.log("[OMANUT-MOTION] approved plan applied:", shots.length, "shots");
      } catch (apErr) {
        console.error("[OMANUT-MOTION] approved_plan invalid:", apErr);
      }
    }

    if (!useScript && !(approved_plan && typeof approved_plan === "object")) {
    const scriptSystem = [
      "You are the Marketing Strategist for " + (company.name || "a business") + ".",
      facts ? facts : "",
      brandBlock ? brandBlock : "",
      "Convert the brief into a video script plan. The FIRST 2 SECONDS must hook (a bold visual statement, a surprising motion, or the product as hero).",
      "STYLE LIBRARY - pick the ONE style that best serves this brief and obey its direction:",
      'Output STRICT JSON only - no markdown, no code fences: {"style": "<one of: ' + STYLE_KEYS.join(" | ") + '>", "hook": "<the 2-second opening idea>", "beats": ["<beat 1>", "<beat 2>", "<beat 3>"], "cta": "<closing call to action>", "voiceover": "<the spoken script for the whole ad, one short line per beat, in the brand voice>"}.',
    ].filter(Boolean).join("\n");
    const scriptRes = await harnessChatWithFallback(
      [{ role: "system", content: scriptSystem }, { role: "user", content: "BRIEF: " + String(brief) }],
      [],
      { companyId: company_id, metadata: company?.metadata || null, mode: "content" }
    );
    script = extractJson(scriptRes.ok && scriptRes.message?.content ? scriptRes.message.content : "") || script;

    // ── STAGE 2: CREATIVE DIRECTOR ─────────────────────────────────────
    const directorSystem = [
      "You are the Creative Director and cinematographer. Convert the marketing plan into a shot-by-shot plan for Seedance (5-second shots).",
      "LOCKED STYLE: " + (MOTION_STYLES[script.style]?.label || script.style || "cinematic") + ".",
      "STYLE DIRECTION (obey this cinematography in every shot): " + (MOTION_STYLES[script.style]?.direction || "Film discipline: motivated camera, naturalistic light, one strong idea per shot."),
      'Output STRICT JSON only — no markdown, no code fences: {"shots": [{"n": 1, "camera": "<camera movement, e.g. slow push-in / orbit / whip pan>", "lighting": "<lighting setup>", "action": "<what happens>", "seedance_prompt": "<ONE paragraph: subject + action + camera movement + lighting + style. No text overlays, no captions, no on-screen words.>"}], "hero_shot": 1}.',
      "2-4 shots. Each seedance_prompt must be self-contained (the model sees only that prompt). Shot n=hero_shot is the strongest single frame of the whole ad.",
    ].join("\n");
    const directorRes = await harnessChatWithFallback(
      [
        { role: "system", content: directorSystem },
        { role: "user", content: "MARKETING PLAN:\n" + JSON.stringify(script) + "\n\nBRIEF: " + String(brief) + (input_image_url ? "\n\nA reference product image will be attached as the first frame input." : "") },
      ],
      [],
      { companyId: company_id, metadata: company?.metadata || null, mode: "content" }
    );
    const plan = extractJson(directorRes.ok && directorRes.message?.content ? directorRes.message.content : "");
    shots = Array.isArray(plan?.shots) && plan.shots.length ? plan.shots : shots;
    heroIdx = Math.min(Math.max(Number(plan?.hero_shot) || 1, 1), shots.length) - 1;
    } // end sub-agent bypass (script_override)

    // plan_only (Director-conversation preview): return the plan WITHOUT
    // rendering. The console shows it to the owner for approval.
    if (plan_only) {
      return new Response(JSON.stringify({
        ok: true,
        plan_only: true,
        style: script.style ?? null,
        hook: script.hook ?? null,
        beats: script.beats ?? [],
        cta: script.cta ?? null,
        voiceover: script.voiceover ?? null,
        shots,
        hero_shot: heroIdx + 1,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const heroShot = shots[heroIdx];

    // ── STAGE 3: GENERATOR (fal.ai queue — hero shot first) ────────────
    // Seedance 2.5 (reference-to-video) when reference images are supplied:
    // it locks product/character/set across up to a 30-second take, with
    // native audio (dialogue) included. Resolution defaults to 480p for 2.5.
    const use25 = refs.length > 0 || model_choice === "seedance-2.5";
    const model = use25
      ? "bytedance/seedance-2.5/reference-to-video"
      : (input_image_url ? FAL_IMAGE_MODEL : FAL_TEXT_MODEL);
    const effectiveResolution = use25 && resolution === "720p" && !body?.resolution ? "480p" : resolution;
    const effectiveDuration = use25 && duration === "5" && !body?.duration ? "auto" : duration;
    const submitBody: Record<string, unknown> = {
      prompt: String(heroShot.seedance_prompt || brief).slice(0, 4000),
      aspect_ratio,
      resolution: effectiveResolution,
      duration: effectiveDuration,
    };
    if (input_image_url) submitBody.image_url = input_image_url;
    if (use25 && refs.length) submitBody.image_urls = refs;

    const submitRes = await fetch(FAL_QUEUE_BASE + "/" + model, {
      method: "POST",
      headers: { Authorization: "Key " + FAL_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(submitBody),
    });
    const submitJson: any = await submitRes.json().catch(() => ({}));
    if (!submitRes.ok || !submitJson.request_id) {
      console.error("[OMANUT-MOTION] fal submit failed:", submitRes.status, submitJson);
      return new Response(JSON.stringify({ error: "fal submit failed", details: submitJson }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: job, error: jobErr } = await supabase
      .from("video_generation_jobs")
      .insert({
        company_id,
        operation_name: submitJson.request_id,
        status: "pending",
        prompt: submitBody.prompt,
        aspect_ratio,
        boss_phone: bossPhone,
        video_provider: "seedance",
        scheduled_post_data: {
          surface: "omanut_motion",
          brief,
          model,
          input_image_url,
          fal_status_url: submitJson.status_url ?? null,
          fal_response_url: submitJson.response_url ?? null,
          resolution,
          duration,
          style: script.style ?? null,
          shot_plan: shots,
          hero_shot: heroIdx + 1,
          marketing_plan: script,
        },
      })
      .select("id")
      .single();
    if (jobErr || !job) {
      return new Response(JSON.stringify({ error: "Job insert failed", details: jobErr?.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await supabase.functions.invoke("poll-video-generation", { body: {} });

    return new Response(
      JSON.stringify({
        job_id: job.id,
        fal_request_id: submitJson.request_id,
        provider: "seedance",
        style: script.style ?? null,
        hero_shot: heroIdx + 1,
        shots_planned: shots.length,
        shot_plan: shots,
        hook: script.hook ?? null,
        cta: script.cta ?? null,
        voiceover: script.voiceover ?? null,
        status: "pending",
        credits_charged: cost,
        credits_remaining: remainingCredits,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[OMANUT-MOTION] fatal:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});