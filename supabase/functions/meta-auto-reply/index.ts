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
          .select("id, name, metadata, whatsapp_number")
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

        // Harness reply (chat mode — but for Meta we gate on company 'on')
        const harnessResult = await harnessChatWithFallback(
          [
            { role: "system", content: "You are the friendly social media assistant for " + (company?.name || "this business") + ". Reply to the customer on Facebook/Instagram in the brand voice. 1-3 short lines. Never invent prices or claims." },
            { role: "user", content: text },
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
          await supabase.functions.invoke("send-facebook-message-reply", {
            body: {
              company_id: row.company_id,
              message_id: payload.message_id,
              sender_id: payload.sender_id,
              page_id: payload.page_id,
              reply_text: reply,
              source_type: "auto",
            },
          });
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
