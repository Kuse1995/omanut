/**
 * meta-auto-reply — drains inbound_events for Meta channels (FB/IG DMs +
 * comments) that currently get NO automatic reply (the queue is never drained).
 *
 * Flow per event:
 *   1. Atomically claim via claim_pending_events RPC (same queue whatsapp uses).
 *   2. Build the reply with the omanut-harness (DeepSeek) when the company has
 *      harness_mode = on; fall back to a safe generic reply on any failure.
 *   3. Send via the existing send-facebook-message-reply / send-facebook-comment-reply
 *      (which persist + send through Meta). Respects is-live-gate on the send side.
 *   4. Mark handled (answered / escalated / declined).
 *
 * KILL SWITCH: harness_mode=off → function returns immediately (no auto-replies).
 * Safety: comment replies keep the 45-120s anti-spam delay (configurable).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { harnessChatWithFallback } from "../_shared/harness-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const COMMENT_DELAY_MIN_MS = Number(Deno.env.get("META_COMMENT_DELAY_MIN_MS") || 45000);
const COMMENT_DELAY_MAX_MS = Number(Deno.env.get("META_COMMENT_DELAY_MAX_MS") || 120000);
const MAX_EVENTS_PER_RUN = Number(Deno.env.get("META_AUTO_REPLY_MAX") || 20);
const SAFE_FALLBACK = "Thanks for your message! We'll get back to you shortly.";

function randomCommentDelay(): number {
  return COMMENT_DELAY_MIN_MS + Math.floor(Math.random() * (COMMENT_DELAY_MAX_MS - COMMENT_DELAY_MIN_MS));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // Cron/secret auth — same pattern as other watchdogs.
  const auth = req.headers.get("authorization") || "";
  const expected = Deno.env.get("CRON_SECRET");
  if (expected && auth !== "Bearer " + expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const results: any[] = [];

  try {
    // Claim pending meta events across all companies (NULL company = all).
    const { data: claimed, error: claimErr } = await supabase.rpc("claim_pending_events", {
      _company_id: null,
      _max: MAX_EVENTS_PER_RUN,
      _claimed_by: "meta-auto-reply",
    });
    if (claimErr) {
      console.error("[META-AUTO-REPLY] claim error:", claimErr.message);
      return new Response(JSON.stringify({ error: claimErr.message }), { status: 500, headers: corsHeaders });
    }

    const rows = (claimed || []).filter((r: any) => r.channel === "direct_message" || r.channel === "public_comment");

    for (const row of rows) {
      try {
        // Company + harness gate
        const { data: company } = await supabase
          .from("companies")
          .select("id, name, metadata, voice_style, hours, services, quick_reference_info")
          .eq("id", row.company_id)
          .maybeSingle();
        const mode = String(company?.metadata?.harness_mode || "off").toLowerCase();
        if (mode !== "on") {
          // Not harness-managed: release back to pending for other handlers.
          await supabase.from("inbound_events").update({ status: "pending", claimed_by: null }).eq("id", row.id);
          results.push({ event_id: row.id, skipped: "harness_off" });
          continue;
        }

        const payload = row.payload || {};
        const text = String(payload.text || payload.body || "");
        if (!text.trim()) {
          await supabase.from("inbound_events").update({ status: "skipped", claimed_by: null }).eq("id", row.id);
          results.push({ event_id: row.id, skipped: "empty" });
          continue;
        }

        // Harness reply — with real context: company facts + post + thread history
        let systemPrompt = "You are the friendly social media assistant for " + (company?.name || "this business") + ". Reply to the customer on Facebook/Instagram in the brand voice. 1-3 short lines. Never invent prices or claims.";
        let userPrompt = text;
        if (row.channel === "public_comment") {
          const ctx = await buildCommentContext(supabase, payload);
          const facts = buildFacts(company);
          systemPrompt = "You are the social media assistant for " + (company?.name || "this business") + ", replying publicly to a comment on the company's Facebook page.\n"
            + (facts ? facts + "\n\n" : "")
            + (ctx ? ctx + "\n\n" : "")
            + "RULES: Reply in 1-3 short lines. Warm, human, social style — no markdown, no hashtags, max 1-2 emojis. Ground the reply in the POST and the facts above; only quote prices/claims that appear in them, never invent. If it needs a private or sensitive answer, invite them to send a DM. Ask a question only if it moves them forward.";
          userPrompt = "Their comment: \"" + text + "\"";
        } else if (row.channel === "direct_message") {
          const history = await buildDmContext(supabase, payload, text);
          const facts = buildFacts(company);
          systemPrompt = "You are the social media assistant for " + (company?.name || "this business") + ", chatting one-on-one with a customer in the company's Facebook/Instagram DMs.\n"
            + (facts ? facts + "\n\n" : "")
            + (history ? history + "\n\n" : "")
            + "RULES: Reply in 1-4 short lines. Warm, human, helpful — no markdown, no hashtags. Ground answers in the facts above; only quote prices that appear in them, never invent. Ask a question only if it moves them toward a purchase or booking. If something is beyond the facts, say you'll double-check with the team rather than guessing.";
          userPrompt = text;
        }
        const harnessResult = await harnessChatWithFallback(
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          [],
          { companyId: row.company_id, metadata: company?.metadata || null, mode: "content" }
        );
        const reply = harnessResult.ok && harnessResult.message?.content
          ? String(harnessResult.message.content)
          : SAFE_FALLBACK;

        // Comment anti-spam delay
        if (row.channel === "public_comment") {
          const d = randomCommentDelay();
          console.log("[META-AUTO-REPLY] comment reply delayed", d, "ms for", row.id);
          await new Promise((r) => setTimeout(r, d));
        }

        // Send via existing functions (persist + Meta send; is-live-gate on their side)
        if (row.channel === "direct_message") {
          // Autonomous Meta DM reply. meta-webhook v2 creates the conversation
          // (fbdm:/igdm: phone) and persists each inbound turn; send-meta-dm
          // sends via Graph /me/messages and persists the outbound turn.
          const conversationId = payload.conversation_id;
          if (!conversationId) {
            await supabase.from("inbound_events").update({ status: "skipped", claimed_by: null }).eq("id", row.id);
            results.push({ event_id: row.id, skipped: "no_conversation" });
            continue;
          }
          const dmRes: any = await supabase.functions.invoke("send-meta-dm", {
            body: { conversationId, text: reply, sent_by: "ai_agent" },
          });
          if (dmRes?.error) {
            throw new Error("send-meta-dm failed: " + JSON.stringify(dmRes.error).slice(0, 300));
          }
        } else {
          await supabase.functions.invoke("send-facebook-comment-reply", {
            body: {
              company_id: row.company_id,
              comment_id: payload.comment_id,
              // Contract: send-facebook-comment-reply Mode 2 expects `message`
              // (same field the mcp-server sends). Without it the call 400s and
              // the event loops forever. reply_text kept for older variants.
              message: reply,
              reply_text: reply,
              source_type: "auto",
            },
          });
        }

        await supabase.from("inbound_events").update({ status: "sent", claimed_by: null }).eq("id", row.id);
        results.push({ event_id: row.id, channel: row.channel, replied: true, reply_len: reply.length });
      } catch (err) {
        console.error("[META-AUTO-REPLY] event failed:", row.id, err instanceof Error ? err.message : err);
        // Release back so it can be retried / surfaced
        await supabase.from("inbound_events").update({ status: "pending", claimed_by: null }).eq("id", row.id);
        results.push({ event_id: row.id, error: String(err instanceof Error ? err.message : err) });
      }
    }

    return new Response(JSON.stringify({ ok: true, processed: rows.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[META-AUTO-REPLY] fatal:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: corsHeaders });
  }
});

// Context for public comment replies: the post they're commenting on, the
// parent comment (when replying to a reply), and the person's recent comments
// on that post — so the AI answers WITH the conversation, not from thin air.
// Every part is optional; a failure here degrades to the bare comment text.
async function buildCommentContext(supabase: any, payload: any): Promise<string> {
  const parts: string[] = [];
  try {
    if (payload.page_id && payload.post_id) {
      const { data: cred } = await supabase
        .from("meta_credentials")
        .select("access_token")
        .eq("page_id", payload.page_id)
        .maybeSingle();
      if (cred?.access_token) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(
          "https://graph.facebook.com/v21.0/" + payload.post_id + "?fields=message&access_token=" + encodeURIComponent(cred.access_token),
          { signal: ctrl.signal }
        );
        clearTimeout(timer);
        const j: any = await res.json().catch(() => ({}));
        if (j?.message) parts.push("THE POST THEY ARE COMMENTING ON:\n\"" + String(j.message).slice(0, 800) + "\"");
      }
    }
  } catch { /* post context is optional */ }
  try {
    if (payload.parent_comment_id) {
      const { data: parent } = await supabase
        .from("facebook_comments")
        .select("comment_text, commenter_name")
        .eq("comment_id", payload.parent_comment_id)
        .maybeSingle();
      if (parent?.comment_text) parts.push("THEY ARE REPLYING TO THIS COMMENT by " + (parent.commenter_name || "someone") + ":\n\"" + String(parent.comment_text).slice(0, 400) + "\"");
    }
  } catch { /* optional */ }
  try {
    if (payload.post_id && payload.commenter_id) {
      const { data: prior } = await supabase
        .from("facebook_comments")
        .select("comment_text, created_at")
        .eq("post_id", payload.post_id)
        .eq("commenter_id", payload.commenter_id)
        .order("created_at", { ascending: false })
        .limit(6);
      const items = (prior || []).filter((c: any) => c.comment_text).slice(0, 5);
      if (items.length) parts.push("THIS PERSON'S RECENT COMMENTS ON THIS POST (newest first):\n" + items.map((c: any, i: number) => (i + 1) + ". \"" + String(c.comment_text).slice(0, 200) + "\"").join("\n"));
    }
  } catch { /* optional */ }
  return parts.join("\n\n");
}

// Company facts block shared by comment + DM prompts (KB grounding for the
// harness price guard: quoted prices must exist in the input).
function buildFacts(company: any): string {
  return [
    company?.voice_style ? "BRAND VOICE: " + company.voice_style : "",
    company?.hours ? "BUSINESS HOURS: " + company.hours : "",
    company?.services ? "PRODUCTS/SERVICES (only quote prices that appear here): " + company.services : "",
    company?.quick_reference_info ? "QUICK FACTS: " + company.quick_reference_info : "",
  ].filter(Boolean).join("\n");
}

// Recent conversation turns for DM replies. meta-webhook v2 persists the
// inbound turn before enqueueing, so drop it from the history (it arrives
// via userPrompt) and feed the rest as grounding.
async function buildDmContext(supabase: any, payload: any, currentText: string): Promise<string> {
  if (!payload.conversation_id) return "";
  try {
    const { data: history } = await supabase
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", payload.conversation_id)
      .order("created_at", { ascending: false })
      .limit(12);
    const items = (history || []).filter((m: any) => m.content);
    if (items.length && items[0].role === "user" && String(items[0].content) === currentText) items.shift();
    const ordered = items.reverse().slice(-10);
    if (!ordered.length) return "";
    return "CONVERSATION SO FAR:\n" + ordered.map((m: any) => (m.role === "user" ? "Customer: " : "You: ") + String(m.content).slice(0, 300)).join("\n");
  } catch { return ""; }
}
