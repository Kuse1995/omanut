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
import { geminiChatWithFallback, PRIMARY_TEXT_MODEL } from "../_shared/gemini-client.ts";
import {
  buildCompanyFacts, searchKnowledgeBase, formatKbMatches,
  profileMissingList, sanitizeFacts, updateCompanyFacts, upsertKbDocument, buildMetaConnectUrl,
  extractJson,
} from "../_shared/company-context.ts";

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

    const bodyData = await req.json().catch(() => ({}));
    const message = String(bodyData.message ?? "").trim();
    const history = Array.isArray(bodyData.history) ? bodyData.history : [];
    const imageUrls: string[] = Array.isArray(bodyData.image_urls) ? bodyData.image_urls.filter((u: any) => !!u).slice(0, 4) : [];
    const origin = String(bodyData.origin || "https://omanut.lovable.app");
    if (!message) {
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
        .select("id, name, metadata, voice_style, hours, services, quick_reference_info")
        .eq("id", companyId)
        .maybeSingle();
      if (!c) {
        return new Response(JSON.stringify({ error: "Company not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      company = c;
    }

    // ── Persistent thread (ChatGPT-style): one conversation per company (or
    // per user while onboarding). History is owned by the server, not the UI.
    const threadKey = companyId ? "agent:" + companyId : "agent:user:" + user.id;
    let threadConvoId: string | null = null;
    {
      const { data: conv } = await supabase
        .from("conversations")
        .select("id")
        .eq("phone", threadKey)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (conv?.id) {
        threadConvoId = conv.id;
      } else {
        const { data: created } = await supabase
          .from("conversations")
          .insert({
            company_id: companyId,
            phone: threadKey,
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

    const facts = company ? buildCompanyFacts(company) : "";
    const kb = company ? formatKbMatches(await searchKnowledgeBase(supabase, company.id, message, 6)) : "";
    const missing = company ? profileMissingList(company) : [];

    // Server-authoritative conversation history (last 10 for AI context).
    const { data: priorThread } = threadConvoId
      ? await supabase.from("messages").select("role, content").eq("conversation_id", threadConvoId).order("created_at", { ascending: false }).limit(10)
      : { data: null };
    const historyMsgs = (priorThread || []).reverse().map((h: any) => ({
      role: h.role === "user" ? "user" : "assistant",
      content: String(h.content || "").slice(0, 500),
    }));

    // History-only call (message empty) — return the full thread, no generation.
    if (!message) {
      const { data: threadRows } = threadConvoId
        ? await supabase.from("messages").select("role, content, created_at").eq("conversation_id", threadConvoId).order("created_at", { ascending: true }).limit(80)
        : { data: [] };
      return new Response(JSON.stringify({
        reply: "",
        action: { type: null },
        company_id: companyId,
        thread: (threadRows || []).map((m: any) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content })),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let system: string;
    if (company) {
      system = [
        "You are the AI agent for " + (company.name || "this business") + " — the owner is chatting with you in their console.",
        facts ? facts : "",
        kb ? kb : "",
        "",
        "CAPABILITIES:",
        "1. Answer questions about the business from the FACTS and KNOWLEDGE BASE MATCHES above (pricing, hours, services, policies).",
        "2. Create video ads — if the user wants a video/ad/reel, begin your reply with exactly \"VIDEO:\" followed by a one-sentence cinematic brief (nothing else after describing it).",
        "3. Draft social posts — if the user wants a post drafted, begin your reply with exactly \"POST:\" followed by the ready-to-publish caption (nothing else).",
        "Otherwise answer normally from the FACTS and KB MATCHES: warm, concise (1-5 short lines), PLAIN TEXT only (no markdown, no asterisks, no bullets), no invented prices or claims. If the answer is not in the provided knowledge, say so and offer to connect the owner.",
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
    const agentMessages = [{ role: "system", content: system }, ...historyMsgs, { role: "user", content: message }];
    const aiResponse = await geminiChatWithFallback({
      model: PRIMARY_TEXT_MODEL,
      messages: agentMessages,
      temperature: 0.7,
      max_tokens: 1200,
    });
    const aiData: any = await aiResponse.json();
    let reply = String(aiData?.choices?.[0]?.message?.content || "").trim();
    if (!reply && aiData?.choices?.[0]?.message?.reasoning_content) {
      reply = String(aiData.choices[0].message.reasoning_content).trim();
    }
    if (!reply) reply = "I couldn't process that just now — please try again.";
    let action: any = { type: null };

    // ── Self-serve onboarding: company creation + claim codes ──────────
    if (reply.toUpperCase().startsWith("CREATE_COMPANY:")) {
      const parsed: any = extractJson(reply.slice(15));
      const name = String(parsed?.name || "").trim();
      if (!name) {
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
    } else if (reply.toUpperCase().startsWith("CLAIM_CODE:")) {
      const code = reply.slice(11).trim();
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

    // ── Conversational onboarding: the agent WRITES the company profile ──
    if (company && reply.toUpperCase().startsWith("SAVE_FACTS:")) {
      const parsed: any = extractJson(reply.slice(11));
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
    } else if (company && reply.toUpperCase().startsWith("SAVE_KB:")) {
      const rest = reply.slice(8).trim();
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
    } else if (company && reply.toUpperCase().trim() === "CONNECT_META") {
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
    if (company && reply.toUpperCase().startsWith("VIDEO:")) {
      const brief = reply.slice(6).trim() || message;
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
        reply = "🎬 Video render started. It takes 1-3 minutes — the finished video lands in your Media Studio and I'll let you know here.";
        action = { type: "video", job_id: motionRes.data?.job_id ?? null, brief };
      }
    } else if (company && reply.toUpperCase().startsWith("POST:")) {
      const caption = reply.slice(5).trim();
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

    // Persist the turn, then return the full thread (ChatGPT-style history).
    if (threadConvoId) {
      await supabase.from("messages").insert({ conversation_id: threadConvoId, role: "user", content: message.slice(0, 2000) });
      await supabase.from("messages").insert({ conversation_id: threadConvoId, role: "assistant", content: reply.slice(0, 4000) });
    }
    const { data: threadRows } = threadConvoId
      ? await supabase.from("messages").select("role, content, created_at").eq("conversation_id", threadConvoId).order("created_at", { ascending: true }).limit(80)
      : { data: [] };

    return new Response(JSON.stringify({
      reply,
      action,
      company_id: companyId,
      thread: (threadRows || []).map((m: any) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content })),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[AGENT-CONSOLE] fatal:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});