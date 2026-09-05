// agent-console — the AaaS customer surface: a ChatGPT-style agent backed by
// the Company Brain. One chat, routed to capabilities:
//   - no company yet            -> conversational onboarding (CREATE_COMPANY
//                                  or claim a code) — self-serve, no admin
//   - knowledge/pricing questions -> answered STRICTLY from company knowledge
//   - "make a video ad about X"   -> omanut-motion (Seedance render)
//   - "draft a post about Y"      -> scheduled_posts (pending_approval)
//   - "connect facebook"          -> Meta OAuth handover (pages auto-linked)
//
// Auth: user JWT required (the UI calls this via supabase.functions.invoke,
// which attaches the session). Company-scoped calls verify membership
// against company_users (global admins allowed). RLS-safe multi-tenancy.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChatWithFallback, geminiChat, PRIMARY_TEXT_MODEL } from "../_shared/gemini-client.ts";
import { callHarness } from "../_shared/harness-client.ts";
import { generateImageSmart } from "../_shared/fal-image.ts";
import {
  buildCompanyFacts, searchKnowledgeBase, formatKbMatches,
  profileMissingList, sanitizeFacts, updateCompanyFacts, upsertKbDocument, buildMetaConnectUrl,
  extractJson,
} from "../_shared/company-context.ts";
import { buildBrandBlock } from "../_shared/marketing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Deploy marker — bump per release; lets us verify what's actually live with one probe.
const AGENT_CONSOLE_BUILD = "2026-09-05-creation-intents";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);

    // Guest mode: signed-out visitors can chat with the onboarding agent
    // (company-less). Company creation / claim / any company-bound action
    // prompts sign-up instead, so we never write orphan rows.
    const authHeader = req.headers.get("Authorization");
    let user: any = null;
    let userClient: any = null;
    if (authHeader) {
      userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData } = await userClient.auth.getUser();
      if (userData?.user) user = userData.user;
    }
    const isGuest = !user;

    const bodyData = await req.json().catch(() => ({}));
    const message = String(bodyData.message ?? "").trim();
    const history = Array.isArray(bodyData.history) ? bodyData.history : [];
    const imageUrls: string[] = Array.isArray(bodyData.image_urls) ? bodyData.image_urls.filter((u: any) => !!u).slice(0, 4) : [];
    // Media attached specifically for posting/scheduling (image or video).
    const postMediaUrl = String(bodyData.post_media_url || "").trim() || null;
    const postMediaType = String(bodyData.post_media_type || "").trim().toLowerCase(); // "image" | "video"
    const origin = String(bodyData.origin || "https://omanut.lovable.app");
    // A genuinely empty chat turn is invalid, but list_threads / history_only
    // requests legitimately carry an empty message (handled below).
    const isThreadReq = bodyData.list_threads === true || bodyData.history_only === true;
    if (!message && !isThreadReq) {
      return new Response(JSON.stringify({ error: "message is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Company may be absent — that's the self-serve onboarding path.
    let companyId: string | null = bodyData.company_id ?? null;
    let company: any = null;

    if (companyId) {
      // Membership (global admins allowed — mirrors meta-oauth-exchange).
      const { data: membership } = await supabase
        .from("company_users")
        .select("company_id")
        .eq("user_id", user.id)
        .eq("company_id", companyId)
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
      const { data: c } = await supabase
        .from("companies")
        .select("id, name, metadata, voice_style, hours, services, quick_reference_info, credit_balance")
        .eq("id", companyId)
        .maybeSingle();
      if (!c) {
        return new Response(JSON.stringify({ error: "Company not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      company = c;
    }

    // ── Persistent threads (ChatGPT-style). A company (or user, while
    // onboarding) can hold MULTIPLE conversations. History is server-owned.
    const threadBase = companyId ? ("agent:" + companyId) : (isGuest ? "guest" : ("agent:user:" + user.id));
    const isListThreads = bodyData.list_threads === true;
    let threadConvoId: string | null = bodyData.thread_id ?? null;
    let newThreadCreated = false;
    let threadAlreadyUntitled = false;

    // Guests have no persisted threads (no owner) — keep it ephemeral.
    if (isGuest) threadConvoId = null;
    if (isGuest && isListThreads) {
      return new Response(JSON.stringify({ reply: "", action: { type: null }, company_id: null, guest: true, threads: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (isListThreads) {
      const { data: threads } = await supabase
        .from("conversations")
        .select("id, customer_name, updated_at")
        .ilike("phone", threadBase + "%")
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(50);
      const threadList = (threads || []).map((t: any) => ({ id: t.id, title: t.customer_name || "New chat", updated_at: t.updated_at }));
      return new Response(JSON.stringify({ reply: "", action: { type: null }, company_id: companyId, threads: threadList }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (threadConvoId) {
      // Validate the thread belongs to this context before using it.
      const { data: owned } = await supabase
        .from("conversations")
        .select("id, phone, customer_name")
        .eq("id", threadConvoId)
        .maybeSingle();
      threadAlreadyUntitled = !!(owned && !String(owned.customer_name || "").trim());
      if (owned && String(owned.phone || "").startsWith(threadBase)) {
        // ok
      } else {
        threadConvoId = null;
      }
    }
    if (!threadConvoId && !isGuest) {
      if (bodyData.new_thread === true) {
        const { data: created } = await supabase
          .from("conversations")
          .insert({
            company_id: companyId,
            phone: threadBase + ":" + crypto.randomUUID().slice(0, 8),
            status: "active",
            customer_name: "",
            active_agent: "agent",
            platform: "agent",
          })
          .select("id")
          .single();
        threadConvoId = created?.id || null;
        newThreadCreated = true;
      } else {
        // Default (backward-compat): the persistent "main" thread for this context.
        const mainPhone = threadBase;
        const { data: conv } = await supabase
          .from("conversations")
          .select("id")
          .eq("phone", mainPhone)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (conv?.id) threadConvoId = conv.id;
        else {
          const { data: created } = await supabase
            .from("conversations")
            .insert({
              company_id: companyId,
              phone: mainPhone,
              status: "active",
              customer_name: company?.name || "Agent Chat",
              active_agent: "agent",
              platform: "agent",
            })
            .select("id")
            .single();
          threadConvoId = created?.id || null;
        }
      }
    }

    const facts = company ? buildCompanyFacts(company) : "";
    // Brand Kit — on-brand guardrail injected into every console reply.
    let brandBlock = "";
    if (company) {
      try {
        const { data: kit } = await supabase.from("brand_kits").select("tone, colors, no_go_phrases, guidelines").eq("company_id", company.id).maybeSingle();
        brandBlock = buildBrandBlock(kit);
      } catch { /* brand kit is optional */ }
    }
    const kb = company ? formatKbMatches(await searchKnowledgeBase(supabase, company.id, message, 6)) : "";
    const missing = company ? profileMissingList(company) : [];

    // Server-authoritative conversation history (last 10 for AI context).
    // Guests have no persisted thread, so we carry the client-supplied
    // history (the console keeps the ephemeral guest conversation in state).
    const { data: priorThread } = threadConvoId
      ? await supabase.from("messages").select("role, content").eq("conversation_id", threadConvoId).order("created_at", { ascending: false }).limit(10)
      : { data: null };
    const historyMsgs = isGuest
      ? history.slice(-10).map((h: any) => ({ role: h.role === "user" ? "user" : "assistant", content: String(h.content || "").slice(0, 500) }))
      : (priorThread || []).reverse().map((h: any) => ({ role: h.role === "user" ? "user" : "assistant", content: String(h.content || "").slice(0, 500) }));

    // History-only call (message empty) — return the full thread, no generation.
    if (!message) {
      const { data: threadRows } = threadConvoId
        ? await supabase.from("messages").select("role, content, created_at, attachments").eq("conversation_id", threadConvoId).order("created_at", { ascending: true }).limit(80)
        : { data: [] };
      return new Response(JSON.stringify({
        reply: "",
        action: { type: null },
        company_id: companyId,
        thread_id: threadConvoId,
        build: AGENT_CONSOLE_BUILD,
        thread: (threadRows || []).map((m: any) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content, attachments: m.attachments || null })),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let system: string;
    if (company) {
      system = [
        "You are the AI agent for " + (company.name || "this business") + " — the owner is chatting with you in their console.",
        facts ? facts : "",
        kb ? kb : "",
        brandBlock ? brandBlock : "",
        "",
        "CAPABILITIES:",
        "1. Answer questions about the business from the FACTS and KNOWLEDGE BASE MATCHES above (pricing, hours, services, policies).",
        "2. Create video ads — if the user wants a video/ad/reel, begin your reply with exactly \"VIDEO:\" followed by a one-sentence cinematic brief (nothing else after describing it).",
        "3. Draft social posts — if the user wants a post drafted, begin your reply with exactly \"POST:\" followed by the ready-to-publish caption (nothing else). If they attached media and ask to post/schedule it, still use \"POST:\" — the attached media is saved with the draft automatically.",
        "4. RUN A CAMPAIGN — if the user asks to run a promo/campaign (e.g. \"run a flash sale\", \"launch campaign\", \"promo\"), begin your reply with exactly \"CAMPAIGN:\" followed by a one-line brief (what's being offered/promoted). The console launches a multi-variant campaign for you.",
        "5. BRAND KIT — if the user shares brand details (colours, tone, fonts, phrases to avoid), reply with exactly \"BRAND:\" followed by those details so they're saved as the brand guardrail.",
        "6. CREATE IMAGES — if the user asks for an image, graphic, poster, picture or visual, begin your reply with exactly \"IMAGE:\" followed by ONE vivid paragraph describing the visual to generate: subject, setting, mood, composition, colors, camera angle, style. Include the brand/product context from the facts. Only specify on-image text if the owner explicitly asked for words on the image.",
        "Otherwise answer normally from the FACTS and KB MATCHES: warm, concise (1-5 short lines), PLAIN TEXT only (no markdown, no asterisks, no bullets), no invented prices or claims. If the answer is not in the provided knowledge, say so and offer to connect the owner.",
        "",
        "UPLOADS: When the owner uploads a knowledge document, acknowledge it by name and note that your answers can now draw from it. When they upload media and ask to post/schedule it, confirm you've attached it to the draft and that it will appear for approval in the Content Scheduler.",
        "ATTACHED IMAGES: you can SEE any image the owner attaches in the current message. When they say \"post about this\", \"make this an ad\", or \"this\" with an image attached, \"this\" IS the image — look at it, describe what matters in one short line, and draft the post/ad around it, grounded in the FACTS (never invent prices). Never say you can't see attachments.",
        "",
        "ONBOARDING (your most important job): this company's profile is still missing: " + (missing.length ? missing.join(", ") : "nothing — profile complete!") + ".",
        "Ask about ONE or TWO missing pieces at a time, conversationally, woven into your replies (never a form, never a list of questions).",
        "When the user's reply contains facts (services, prices, hours, location, tone, anything worth remembering), begin your reply with exactly \"SAVE_FACTS:\" followed by a STRICT JSON object mapping field names to values (fields: name, industry, business_type, voice_style, hours, services, branches, service_locations, currency_prefix, quick_reference_info, payment_instructions) — then add one short confirmation line after it.",
        "When the user shares a longer knowledge document (policies, menus, FAQs, training material), begin with exactly \"SAVE_KB:\" + filename + \":\" on the first line, then the document text on the following lines.",
        "When the user wants to connect Facebook/Instagram, reply with exactly \"CONNECT_META\" on its own — the console will show the connect button.",
        "After saving, confirm warmly what you remembered and ask for the next missing piece. Never invent facts the owner did not give you.",
      ].filter(Boolean).join("\n");
    } else {
      system = [
        "You are the Omanut onboarding agent. A new owner just signed up to put their business on the platform — there is NO company profile yet.",
        "Your job: interview them warmly and set up their business. Ask ONE or TWO questions per reply, never a form.",
        "FIRST ask for the business name. Then, as the conversation allows: what they sell + prices, opening hours, location/areas served, anything else worth remembering.",
        "As soon as you know at least the business NAME (ideally + what they sell), begin your reply with exactly \"CREATE_COMPANY:\" followed by a STRICT JSON object: {\"name\": \"...\", \"business_type\": \"...\", \"services\": \"...\", \"hours\": \"...\", \"currency_prefix\": \"K\", \"quick_reference_info\": \"...\"} — then one short confirmation line (e.g. \"🎉 Your business is live — now tell me about your hours…\").",
        "If they mention a claim code from Omanut instead, reply with exactly \"CLAIM_CODE:\" followed by the code (nothing else).",
        "Never invent facts they didn't give you. Keep every reply 1-4 short lines, warm and human, PLAIN TEXT only (no markdown, no asterisks). When you've created the company, keep interviewing for the remaining profile details.",
      ].join("\n");
    }

    // Direct platform AI — multi-provider fallback chain (DeepSeek -> Kimi ->
    // GLM -> Gemini -> MiniMax) on the project's own keys. The farm harness is
    // WhatsApp-specific (tone rules, price guard, 12-25s client timeout) and
    // was failing on long grounded prompts; the console needs longer
    // generations without that ceiling.
    // ── Deterministic draft follow-through (before the AI) ─────────────
    // When a draft is already pending approval, "post it", "i approve" or
    // "post it right now" must ACT on THAT draft — never draft a different
    // caption. The pending draft is also injected into the prompt so the
    // model never duplicates it.
    let reply = "";
    let action: any = { type: null };
    let assistantAttachments: any[] | null = null;
    let imageBrief: string | null = null;
    let preHandled = false;
    let pendingPost: any = null;
    if (company) {
      const { data: pp } = await supabase
        .from("scheduled_posts")
        .select("id, content, scheduled_time")
        .eq("company_id", company.id)
        .eq("status", "pending_approval")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      pendingPost = pp || null;

      const t = message.trim();
      const short = t.length <= 100;
      const confirmish = short && /(post\s*(it|this|that|now)|publish|share\s*(it|this|that)?|go\s*live|send\s*it|push\s*it|approv(e|ed|al)|i\s+approve|go\s*ahead|confirm)/i.test(t);
      const wantsNow = /\b(now|right now|immediately|asap)\b/i.test(t);
      const approveIntent = /\bapprove\b/i.test(t) && /\b(it|that|this|them|the post|post)\b/i.test(t);
      const publishNowIntent = /(post|publish|share)\b[^.!?]{0,40}\b(right now|now|immediately|asap)\b/i.test(t);

      if (pendingPost && (confirmish || approveIntent || publishNowIntent)) {
        if (wantsNow || publishNowIntent) {
          await supabase.from("scheduled_posts").update({ status: "approved", updated_at: new Date().toISOString() }).eq("id", pendingPost.id);
          const pub: any = await supabase.functions.invoke("publish-meta-post", { body: { post_id: pendingPost.id } });
          if (pub?.error || pub?.data?.error) {
            reply = "⚠️ I tried to publish it now but the platform said: " + (pub?.data?.error || pub?.error?.message || "unknown error") + ". Your post is safe in the Content Scheduler — you can publish it from there.";
            action = { type: "post_publish_failed", post_id: pendingPost.id };
          } else {
            reply = "🚀 It's live! Published to your page" + (pub?.data?.platforms?.instagram === "success" ? "s (Facebook + Instagram)" : "") + " just now.";
            action = { type: "post_published", post_id: pendingPost.id, meta_post_id: pub?.data?.meta_post_id ?? null };
          }
        } else {
          await supabase.from("scheduled_posts").update({ status: "approved", updated_at: new Date().toISOString() }).eq("id", pendingPost.id);
          const when = new Date(pendingPost.scheduled_time).toLocaleString();
          reply = "✅ Approved — it's scheduled to go live " + when + ". Say \"post it right now\" to push it out immediately.";
          action = { type: "post_approved", post_id: pendingPost.id };
        }
        preHandled = true;
      } else if (pendingPost) {
        // A draft is waiting: tell the model so it never drafts a duplicate.
        system += "\n\nPENDING APPROVAL: one drafted post is awaiting the owner's approval. It starts with: \"" + String(pendingPost.content).slice(0, 120) + "\". If the owner confirms or asks to post it WITHOUT adding new content, reply with exactly APPROVE: on its own line — or APPROVE NOW: if they want it live immediately. Never draft a duplicate POST.";
      }

      // ── Deterministic creation intents: image / video ──────────────────
      // The farm brain doesn't reliably emit tool escapes, so creation is
      // detected HERE; the model is used only as a brief writer.
      const imageIntent = /\b(image|picture|graphic|poster|visual|photo|banner|flyer)\b/i.test(message) && /\b(create|make|generate|design|draw|produce)\b/i.test(message);
      const videoIntent = /\b(video|reel|animated)\b/i.test(message) && /\b(create|make|generate|produce|turn|draft)\b/i.test(message);
      const writeBrief = async (kind: "image" | "video"): Promise<string> => {
        const sys = kind === "image"
          ? "You are an art director for " + (company?.name || "the business") + ". The owner wants a marketing image. Write ONE paragraph (3-5 sentences) visual brief for an image generator: subject, setting, mood, composition, colors, camera angle and style, grounded in this request and business. Output ONLY the brief paragraph — no preamble, no quotes."
          : "You are a creative director for " + (company?.name || "the business") + ". The owner wants a short marketing video. Write ONE cinematic brief (3-4 sentences): the 2-second hook, visual beats, mood, style and CTA. Output ONLY the brief.";
        let out = "";
        try {
          const h = await callHarness({ session_id: "console:" + company.id + ":brief:" + Date.now(), messages: [{ role: "system", content: sys }, { role: "user", content: message }], tools: [] });
          if (h.ok && h.message?.content) out = String(h.message.content).trim();
        } catch { /* harness optional */ }
        if (!out) {
          try {
            const r = await geminiChat({ model: PRIMARY_TEXT_MODEL, messages: [{ role: "system", content: sys }, { role: "user", content: message }], temperature: 0.8, max_tokens: 400 });
            const d: any = await r.json();
            out = String(d?.choices?.[0]?.message?.content || "").trim();
          } catch { /* fall through */ }
        }
        return out || message;
      };
      if (videoIntent) {
        const brief = await writeBrief("video");
        try {
          const motionRes: any = await supabase.functions.invoke("omanut-motion", { body: { company_id: company.id, brief: brief.slice(0, 500), user_id: user.id } });
          if (motionRes?.error || motionRes?.data?.error) {
            reply = "I couldn't start the video render just now — please try again in a moment.";
          } else {
            reply = "🎬 Video render started — it lands in your Media Studio in 1-3 minutes.";
            action = { type: "video", job_id: motionRes.data?.job_id ?? null, brief };
          }
        } catch (e5: any) {
          reply = "I couldn't start the video render just now — please try again in a moment.";
        }
        preHandled = true;
      } else if (imageIntent) {
        imageBrief = await writeBrief("image");
        preHandled = true; // the generation block below runs instead of a chat turn
      }
    }

    const aiErrors: string[] = [];

    if (!preHandled) {
    // Vision: when the owner attached media, the model must actually SEE it.
    // Route image turns to a vision-capable model (DeepSeek text models can't
    // read images) and pass the URLs as OpenAI-style image parts.
    const toDataUri = async (u: string): Promise<string | null> => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(u, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) return null;
        const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
        if (!mime.startsWith("image/")) return null;
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length > 4_500_000) return null;
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
          bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        return "data:" + mime + ";base64," + btoa(bin);
      } catch {
        return null;
      }
    };
    const visionRaw = [...imageUrls, ...(postMediaUrl && postMediaType === "image" ? [postMediaUrl] : [])]
      .filter(Boolean).slice(0, 3);
    const visionParts: any[] = [];
    for (const u of visionRaw) {
      const uri = await toDataUri(u);
      if (uri) visionParts.push({ type: "image_url", image_url: { url: uri } });
    }
    const sawImage = visionParts.length > 0;
    const userText = sawImage
      ? message
      : (visionRaw.length ? message + "\n\n(An image was attached but it could not be read — ask the owner to re-upload it.)" : message);
    const userContent: any = sawImage
      ? [{ type: "text", text: userText }, ...visionParts]
      : userText;
    const agentMessages = [{ role: "system", content: system }, ...historyMsgs, { role: "user", content: userContent }];
    const aiController = new AbortController();
    const aiTimer = setTimeout(() => aiController.abort(), 60000);
    if (sawImage) {
      // PRIMARY brain: the Omanut farm harness (GLM-5.3-Flash) — own
      // infrastructure, proven in production, no third-party key/balance
      // dependency. Image parts pass straight through to the GLM brain.
      try {
        const h = await callHarness({
          session_id: "console:" + (company?.id || "guest") + ":" + Date.now(),
          messages: agentMessages,
          tools: [],
        });
        const hText = String(h.message?.content || "").trim();
        if (h.ok && hText) { reply = hText; console.log("[AGENT-CONSOLE] vision answered by farm harness (primary)"); }
        else aiErrors.push("harness(vision): " + (h.reason || "no content"));
      } catch (hErr: any) {
        aiErrors.push("harness(vision): " + (hErr?.message || hErr));
      }
      // Fallbacks: direct vision models only (never blind text models — that
      // cascade was exhausting and ending in a 500).
      const visionModels = [
        Deno.env.get("VISION_MODEL") || "glm-5.3-flash",
        "glm-4.5v",
        "google/gemini-2.5-flash",
      ];
      for (const vm of visionModels) {
        try {
          const vRes = await geminiChat({
            model: vm,
            messages: agentMessages,
            temperature: 0.7,
            max_tokens: 2000,
            signal: aiController.signal,
          });
          const vData: any = await vRes.json();
          const vText = String(vData?.choices?.[0]?.message?.content || "").trim();
          if (vText) { reply = vText; console.log("[AGENT-CONSOLE] vision answered by", vm); break; }
          aiErrors.push("vision:" + vm + ": empty content");
          console.warn("[AGENT-CONSOLE] vision model returned empty content:", vm);
        } catch (vErr: any) {
          aiErrors.push("vision:" + vm + ": " + (vErr?.message || vErr));
          console.warn("[AGENT-CONSOLE] vision model failed:", vm, vErr?.message || vErr);
        }
      }
    }
    if (!reply) {
      // Text path. PRIMARY brain: the Omanut farm harness (GLM-5.3-Flash) —
      // own infrastructure, no third-party key/balance dependency.
      try {
        const h = await callHarness({
          session_id: "console:" + (company?.id || "guest") + ":" + Date.now(),
          messages: [{ role: "system", content: system }, ...historyMsgs, { role: "user", content: userText }],
          tools: [],
        });
        const hText = String(h.message?.content || "").trim();
        if (h.ok && hText) { reply = hText; console.log("[AGENT-CONSOLE] text answered by farm harness (primary)"); }
        else aiErrors.push("harness(text): " + (h.reason || "no content"));
      } catch (hErr: any) {
        aiErrors.push("harness(text): " + (hErr?.message || hErr));
      }
      // Fallbacks: direct providers (never 500s — guaranteed reply below).
      const textModels = [PRIMARY_TEXT_MODEL, "google/gemini-2.5-flash"];
      for (const tm of textModels) {
        try {
          const aiResponse = await geminiChat({
            model: tm,
            messages: [{ role: "system", content: system }, ...historyMsgs, { role: "user", content: userText }],
            temperature: 0.7,
            max_tokens: 2000,
            signal: aiController.signal,
          });
          const aiData: any = await aiResponse.json();
          const t = String(aiData?.choices?.[0]?.message?.content || "").trim();
          if (t) { reply = t; break; }
          aiErrors.push("text:" + tm + ": empty content");
          console.warn("[AGENT-CONSOLE] text model returned empty content:", tm);
        } catch (aiErr: any) {
          aiErrors.push("text:" + tm + ": " + (aiErr?.message || aiErr));
          console.warn("[AGENT-CONSOLE] text model failed:", tm, aiErr?.message || aiErr);
        }
      }
    }
    clearTimeout(aiTimer);
    } // end !preHandled (AI generation skipped for deterministic intents)
    // NEVER surface raw reasoning_content as the reply — when the model spends
    // its whole token budget thinking, content comes back empty and the leaked
    // chain-of-thought was being dumped into the chat verbatim.
    if (!reply) reply = "I couldn't process that just now — please try again in a moment.";

    // ── Tool escapes: model-proof parsing ──────────────────────────────
    // Models wrap escapes in code fences, indent them, or drop the prefix
    // entirely (bare JSON). Parse every escape regardless of formatting.
    const normReply = reply.replace(/```[a-z]*/gi, "").trim();
    const findAfter = (tag: string): string | null => {
      const re = new RegExp("(?:^|\\n)\\s*" + tag + "\\s*:?\\s*", "i");
      const m = normReply.match(re);
      return m ? normReply.slice((m.index ?? 0) + m[0].length).trim() : null;
    };
    const bareJson = normReply.startsWith("{") ? normReply : null;
    const jsonHasFacts = !!bareJson && /"(services|hours|voice_style|branches|service_locations|payment_instructions|quick_reference_info|currency_prefix|business_type|industry|name)"\s*:/i.test(normReply);
    const companyCreated = findAfter("CREATE_COMPANY:");
    const claimCode = findAfter("CLAIM_CODE:");
    const saveFacts = company ? (findAfter("SAVE_FACTS:") ?? (jsonHasFacts ? bareJson : null)) : null;
    const saveKb = company ? findAfter("SAVE_KB:") : null;
    const connectMeta = !!company && normReply.toUpperCase().startsWith("CONNECT_META");
    const videoBrief = company ? findAfter("VIDEO:") : null;
    const postCaption = company ? findAfter("POST:") : null;
    const campaignBrief = company ? findAfter("CAMPAIGN:") : null;
    const brandDetail = company ? findAfter("BRAND:") : null;
    const escImageBrief = company ? findAfter("IMAGE:") : null;
    if (escImageBrief !== null) imageBrief = escImageBrief;
    // Draft confirmation escapes (the prompt tells the model to emit these
    // when a draft is already pending and the owner confirms it).
    const approveNowEsc = company ? findAfter("APPROVE NOW:") : null;
    const approveEsc = company && approveNowEsc === null ? findAfter("APPROVE:") : null;

    // ── Self-serve onboarding: company creation + claim codes ──────────
    if (companyCreated !== null) {
      const parsed: any = extractJson(companyCreated);
      const name = String(parsed?.name || "").trim();
      if (isGuest) {
        // No account yet — we can't create an owned company. Prompt sign-up.
        action = { type: "signup_required", name };
        reply = "🎉 " + (name || "Your business") + " is ready to go live! Create a free Omanut account and I'll set up your business profile and connect your channels in one click.";
      } else if (!name) {
        reply = "I just need the business name to set you up — what's it called?";
      } else {
        const { data: newCo, error: cErr } = await supabase
          .from("companies")
          .insert({
            name,
            business_type: parsed?.business_type || null,
            services: parsed?.services || null,
            hours: parsed?.hours || null,
            currency_prefix: parsed?.currency_prefix || "K",
            quick_reference_info: parsed?.quick_reference_info || null,
            test_mode: true,
            credit_balance: 1000,
            agent_takeover_enabled: true,
            metadata: { harness_mode: "on" },
          })
          .select("id")
          .single();
        if (cErr) throw cErr;
        const newCompanyId: string = newCo.id;
        await supabase.from("company_users").insert({
          company_id: newCompanyId,
          user_id: user.id,
          role: "owner",
          is_default: true,
          accepted_at: new Date().toISOString(),
        });
        await supabase.from("user_roles").upsert(
          { user_id: user.id, role: "client" },
          { onConflict: "user_id,role", ignoreDuplicates: true }
        );
        await supabase.from("users").upsert(
          { id: user.id, email: user.email ?? null, company_id: newCompanyId, role: "admin" },
          { onConflict: "id" }
        );
        companyId = newCompanyId;
        company = { id: newCompanyId, name, metadata: { harness_mode: "on" } };
        action = { type: "company_created", company_id: newCompanyId, name };
        reply = "🎉 " + name + " is live on Omanut! Now tell me more — your services, prices, hours — I'll remember everything. And when you're ready, say \"connect\" to link Facebook & Instagram.";
      }
    } else if (claimCode !== null) {
      const code = claimCode;
      if (isGuest) {
        action = { type: "signup_required" };
        reply = "🔒 To claim that business you'll need an account first. Create a free one and I'll link you instantly.";
      } else {
      const { data: claimData, error: claimErr } = await userClient.rpc("claim_company", { _code: code });
      if (claimErr || !claimData?.success) {
        reply = "⚠️ That claim code didn't work: " + (claimErr?.message || "invalid code") + ". Check it and try again — or just tell me about your business and I'll set you up fresh.";
      } else {
        companyId = claimData.company_id;
        const { data: claimedCo } = await supabase
          .from("companies")
          .select("id, name, metadata, voice_style, hours, services, quick_reference_info")
          .eq("id", companyId)
          .maybeSingle();
        company = claimedCo || null;
        action = { type: "company_claimed", company_id: companyId, name: claimData.company_name ?? null };
        reply = "✅ Claimed " + (claimData.company_name || "your business") + "! Your agent is live — everything you tell me now is remembered across every channel.";
      }
      }
    }

    // ── Conversational onboarding: the agent WRITES the company profile ──
    if (saveFacts !== null) {
      const parsed: any = extractJson(saveFacts);
      try {
        const { saved } = await updateCompanyFacts(supabase, company.id, parsed);
        const stillMissing = profileMissingList(company).filter((m) => !saved.some((s) => m.startsWith(s)));
        reply = saved.length
          ? "✅ Got it — saved to your company profile: " + saved.join(", ") + ". " + (stillMissing.length ? "Next up: " + stillMissing.join(", ") + "." : "Your profile is complete!")
          : "I couldn't find any profile facts in that — tell me the details in your own words and I'll remember them.";
        action = { type: "facts_saved", saved };
      } catch (e: any) {
        reply = "⚠️ Save failed: " + (e?.message || "unknown error");
      }
    } else if (saveKb !== null) {
      const rest = saveKb;
      const nl = rest.indexOf("\n");
      const filename = (nl >= 0 ? rest.slice(0, nl) : rest).trim() || "knowledge-" + Date.now() + ".md";
      const content = nl >= 0 ? rest.slice(nl + 1).trim() : rest;
      try {
        await upsertKbDocument(supabase, company.id, filename, content);
        reply = "📚 Saved to your knowledge base as \"" + filename + "\". Every channel now answers from it.";
        action = { type: "kb_saved", filename };
      } catch (e: any) {
        reply = "⚠️ KB save failed: " + (e?.message || "unknown error");
      }
    } else if (approveNowEsc !== null || approveEsc !== null) {
      // The owner confirmed the pending draft (model relayed APPROVE:/APPROVE NOW:).
      const { data: pp2 } = await supabase
        .from("scheduled_posts")
        .select("id, scheduled_time")
        .eq("company_id", company.id)
        .eq("status", "pending_approval")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!pp2) {
        reply = "There's no draft waiting for approval right now — tell me what you'd like to post and I'll draft it.";
      } else if (approveNowEsc !== null) {
        await supabase.from("scheduled_posts").update({ status: "approved", updated_at: new Date().toISOString() }).eq("id", pp2.id);
        const pub: any = await supabase.functions.invoke("publish-meta-post", { body: { post_id: pp2.id } });
        if (pub?.error || pub?.data?.error) {
          reply = "⚠️ I tried to publish it now but the platform said: " + (pub?.data?.error || pub?.error?.message || "unknown error") + ". Your post is safe in the Content Scheduler.";
          action = { type: "post_publish_failed", post_id: pp2.id };
        } else {
          reply = "🚀 It's live! Published to your page just now.";
          action = { type: "post_published", post_id: pp2.id, meta_post_id: pub?.data?.meta_post_id ?? null };
        }
      } else {
        await supabase.from("scheduled_posts").update({ status: "approved", updated_at: new Date().toISOString() }).eq("id", pp2.id);
        const when = new Date(pp2.scheduled_time).toLocaleString();
        reply = "✅ Approved — it's scheduled to go live " + when + ". Say \"post it right now\" to push it out immediately.";
        action = { type: "post_approved", post_id: pp2.id };
      }
    } else if (connectMeta) {
      const appId = Deno.env.get("META_APP_ID");
      const configId = Deno.env.get("META_CONFIG_ID");
      if (!appId) {
        reply = "⚠️ Meta connect isn't configured on this project yet — an operator needs to add META_APP_ID.";
      } else {
        const state = crypto.randomUUID();
        const connectUrl = buildMetaConnectUrl(
          String(origin || "https://omanut.lovable.app"),
          appId, configId, state,
        );
        action = { type: "meta_connect", connect_url: connectUrl, state };
        reply = "🔗 Connect your Facebook & Instagram — one click, and your pages link to this agent automatically. (Popups must be allowed.)";
      }
    }

    // Route tool escapes (video + post) — company-scoped.
    if (videoBrief !== null) {
      const brief = videoBrief || message;
      const looksLikeScript = imageUrls.length > 0 && message.length > 400;
      const motionBody: Record<string, unknown> = looksLikeScript
        ? { company_id: company.id, brief: message.slice(0, 200), script_override: message, image_urls: imageUrls }
        : { company_id: company.id, brief, image_urls: imageUrls };
      const motionRes: any = await supabase.functions.invoke("omanut-motion", {
        body: motionBody,
      });
      if (motionRes?.error) {
        console.error("[AGENT-CONSOLE] omanut-motion failed:", motionRes.error);
        reply = "I couldn't start the video render just now — please try again in a moment.";
      } else {
        const creditsLeft = motionRes.data?.credits_remaining;
        reply = "🎬 Video render started. It takes 1-3 minutes — the finished video lands in your Media Studio and I'll let you know here." + (creditsLeft != null ? " (Credits left: " + creditsLeft + ")" : "");
        action = { type: "video", job_id: motionRes.data?.job_id ?? null, brief, credits_remaining: creditsLeft ?? null };
      }
    } else if (postCaption !== null) {
      const caption = postCaption;
      const { data: cred } = await supabase
        .from("meta_credentials")
        .select("page_id")
        .eq("company_id", company.id)
        .limit(1)
        .maybeSingle();
      if (!cred?.page_id) {
        reply = "I can draft posts, but no Facebook page is connected yet — say \"connect\" and link your pages first.";
      } else {
        const { data: post, error: postErr } = await supabase
          .from("scheduled_posts")
          .insert({
            company_id: company.id,
            page_id: cred.page_id,
            content: caption,
            target_platform: "facebook",
            scheduled_time: new Date(Date.now() + 3600000).toISOString(),
            status: "pending_approval",
            created_by: user.id,
            // Media the owner attached for this post.
            image_url: postMediaType === "image" ? postMediaUrl : null,
            video_url: postMediaType === "video" ? postMediaUrl : null,
          })
          .select("id")
          .single();
        if (postErr) {
          console.error("[AGENT-CONSOLE] post insert failed:", postErr);
          reply = "The draft failed to save — please try again.";
        } else if (/\b(right now|immediately|asap)\b/i.test(message)) {
          // "post it right now" with no existing draft: publish immediately.
          await supabase.from("scheduled_posts").update({ status: "approved", updated_at: new Date().toISOString() }).eq("id", post.id);
          const pub: any = await supabase.functions.invoke("publish-meta-post", { body: { post_id: post.id } });
          if (pub?.error || pub?.data?.error) {
            reply = "📝 Your post is saved in the Content Scheduler, but publishing just now failed: " + (pub?.data?.error || pub?.error?.message || "unknown error");
            action = { type: "post", post_id: post?.id ?? null };
          } else {
            reply = "🚀 It's live! Published to your page just now:\n\n" + caption;
            action = { type: "post_published", post_id: post?.id ?? null, meta_post_id: pub?.data?.meta_post_id ?? null };
          }
        } else {
          reply = "📝 Post drafted and saved for your approval in the Content Scheduler:\n\n" + caption;
          action = { type: "post", post_id: post?.id ?? null };
        }
      }
    } else if (campaignBrief !== null) {
      // Launch a multi-variant Grow Engine campaign through campaign-engine.
      const brief = campaignBrief || message;
      const playbook = String(bodyData.playbook || "").trim() || "custom";
      try {
        const campRes: any = await supabase.functions.invoke("campaign-engine", {
          body: { action: "create", company_id: company.id, brief: brief.slice(0, 500), playbook, channels: ["facebook", "instagram"], variant_count: 3, user_id: user.id },
        });
        if (campRes?.error || campRes?.data?.error) {
          console.error("[AGENT-CONSOLE] campaign-engine failed:", campRes?.error || campRes?.data?.error);
          reply = "I couldn't launch the campaign just now — please try again in a moment.";
        } else {
          reply = "🚀 Campaign launched! I created 3 on-brand variants and scheduled them for approval in your Growth hub. Watch them, then I can promote the best performer.";
          action = { type: "campaign", campaign_id: campRes.data?.campaign_id ?? null };
        }
      } catch (e2: any) {
        console.error("[AGENT-CONSOLE] campaign invoke threw:", e2);
        reply = "I couldn't launch the campaign just now — please try again in a moment.";
      }
    } else if (brandDetail !== null) {
      // Save the brand kit guardrail (upsert one per company).
      const detail = brandDetail;
      const { data: existing } = await supabase.from("brand_kits").select("id").eq("company_id", company.id).maybeSingle();
      if (existing?.id) {
        await supabase.from("brand_kits").update({ guidelines: detail.slice(0, 2000), updated_by: user.id, updated_at: new Date().toISOString() }).eq("id", existing.id);
      } else {
        await supabase.from("brand_kits").insert({ company_id: company.id, guidelines: detail.slice(0, 2000), updated_by: user.id });
      }
      reply = "🎨 Brand guardrail saved — I'll keep every post and video on-brand from now on. Tell me your colours, tone, and any phrases to avoid and I'll remember those too.";
      action = { type: "brand_saved" };
    } else if (imageBrief !== null) {
      // CREATE IMAGES: generate on fal (Nano Banana 2), save to company media,
      // and show it in the chat bubble.
      try {
        const balance = Number((company as any)?.credit_balance ?? 0);
        if (balance < 1) {
          reply = "⚠️ You're out of generation credits — top up your plan and I'll create images again.";
          action = { type: "image_failed", reason: "insufficient_credits" };
        } else {
          const gen = await generateImageSmart({ prompt: imageBrief, aspectRatio: Deno.env.get("FAL_IMAGE_ASPECT") || "1:1" });
          const match = gen.imageBase64.match(/^data:(image\/[\w+]+);base64,(.+)$/);
          if (!match) throw new Error("unexpected image payload");
          const mime = match[1];
          const bytes = new Uint8Array(atob(match[2]).length);
          const bin = atob(match[2]);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const path = company.id + "/generated/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + (mime.includes("jpeg") ? ".jpg" : ".png");
          const { error: upErr } = await supabase.storage.from("company-media").upload(path, bytes, { contentType: mime, upsert: false });
          if (upErr) throw upErr;
          const { data: pub } = supabase.storage.from("company-media").getPublicUrl(path);
          const imageUrl = pub.publicUrl;
          await supabase.from("companies").update({ credit_balance: balance - 1 }).eq("id", company.id).gte("credit_balance", 1);
          reply = "🖼️ Here's your image — saved to your media library. Want me to draft a post around it, or turn the concept into a video?";
          action = { type: "image_created", url: imageUrl };
          assistantAttachments = [{ url: imageUrl, type: "image" }];
        }
      } catch (e3: any) {
        console.error("[AGENT-CONSOLE] image generation failed:", e3?.message || e3);
        reply = "⚠️ Image generation failed just now (" + String(e3?.message || e3).slice(0, 120) + "). Tell me the concept again and I'll retry.";
        action = { type: "image_failed" };
      }
    }

    // Persist the turn, then return the full thread (ChatGPT-style history).
    // Attachments ride on the user message so they stay visible in history.
    const turnAttachments = Array.isArray(bodyData.attachments) && bodyData.attachments.length
      ? bodyData.attachments.slice(0, 4).map((a: any) => ({ url: String(a.url || ""), type: String(a.type || "image") })).filter((a: any) => a.url)
      : null;
    if (threadConvoId) {
      await supabase.from("messages").insert({ conversation_id: threadConvoId, role: "user", content: message.slice(0, 2000), attachments: turnAttachments });
      await supabase.from("messages").insert({ conversation_id: threadConvoId, role: "assistant", content: reply.slice(0, 4000), attachments: assistantAttachments });
      // Auto-title a fresh thread from its first user message (ChatGPT-style).
      if (newThreadCreated || threadAlreadyUntitled) {
        await supabase.from("conversations").update({ customer_name: message.slice(0, 48) }).eq("id", threadConvoId);
      }
    }
    const { data: threadRows } = threadConvoId
      ? await supabase.from("messages").select("role, content, created_at, attachments").eq("conversation_id", threadConvoId).order("created_at", { ascending: true }).limit(80)
      : { data: [] };

    return new Response(JSON.stringify({
      reply,
      action,
      company_id: companyId,
      thread_id: threadConvoId,
      build: AGENT_CONSOLE_BUILD,
      thread: (threadRows || []).map((m: any) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content, attachments: m.attachments || null })),
      // Diagnostics for the operator: pass debug:true to see why AI models failed.
      ai_errors: bodyData.debug === true ? aiErrors : undefined,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[AGENT-CONSOLE] fatal:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});