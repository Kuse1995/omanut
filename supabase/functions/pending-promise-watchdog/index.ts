import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Promise patterns — assistant messages that imply a follow-up will come.
const PROMISE_PATTERNS: RegExp[] = [
  /give me (one |a )?moment/i,
  /checking on (that|it|this)/i,
  /let me (check|confirm|verify|look)/i,
  /\bone moment\b/i,
  /i'?ll (get back|come back|check|confirm)/i,
  /working on (that|it)/i,
  /let me check what/i,
  /find some pictures/i,
];

// The synthesis-fallback signature — short message ending with hourglass/folded-hands/magnifier.
const FALLBACK_SIGNATURE = /[…\.]{0,3}\s*[🙏🔍⏳]\s*$/;

function isPromiseMessage(content: string): boolean {
  if (!content) return false;
  const trimmed = content.trim();
  if (PROMISE_PATTERNS.some((re) => re.test(trimmed))) return true;
  if (trimmed.length < 120 && FALLBACK_SIGNATURE.test(trimmed)) return true;
  return false;
}

function normalizeWhatsApp(phone: string): string {
  if (!phone) return "";
  return phone.startsWith("whatsapp:") ? phone : `whatsapp:${phone.startsWith("+") ? phone : `+${phone.replace(/^\+/, "")}`}`;
}

const PROMISE_AGE_MIN_SECONDS = 90;          // wait at least 90s before declaring abandoned
const PROMISE_AGE_MAX_SECONDS = 15 * 60;     // ignore anything older than 15 min
const COOLDOWN_SECONDS = 10 * 60;            // 10 min cooldown between fulfillments per conversation
const MAX_FULFILLMENTS_PER_HOUR = 2;         // hard cap per conversation per rolling hour
const MAX_FULFILLMENTS_PER_RUN = 5;          // global cap per cron tick

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const startedAt = Date.now();
  const stats = { scanned: 0, candidates: 0, fulfilled: 0, escalated: 0, skipped: 0, paused: 0 };

  try {
    const cutoff = new Date(Date.now() - PROMISE_AGE_MAX_SECONDS * 1000).toISOString();
    const { data: convs, error: convErr } = await supabase
      .from("conversations")
      .select("id, company_id, phone, customer_name, last_message_at, status, is_paused_for_human, last_promise_fulfillment_at, promise_fulfillment_count, promise_fulfillment_window_start, companies!inner(whatsapp_number, boss_phone)")
      .eq("status", "active")
      .or("is_paused_for_human.is.null,is_paused_for_human.eq.false")
      .gte("last_message_at", cutoff)
      .order("last_message_at", { ascending: false })
      .limit(80);

    if (convErr) throw convErr;
    stats.scanned = convs?.length || 0;

    for (const conv of convs || []) {
      if (stats.fulfilled >= MAX_FULFILLMENTS_PER_RUN) break;
      const company: any = (conv as any).companies;
      if (!company?.whatsapp_number) continue;

      // CONVERSATION-LEVEL COOLDOWN — check first, before reading messages
      const lastFulfill = (conv as any).last_promise_fulfillment_at;
      if (lastFulfill) {
        const sinceSec = (Date.now() - new Date(lastFulfill).getTime()) / 1000;
        if (sinceSec < COOLDOWN_SECONDS) {
          console.log(`[PROMISE-WATCHDOG] conv=${conv.id} action=skip (cooldown ${Math.round(sinceSec)}s < ${COOLDOWN_SECONDS}s)`);
          stats.skipped += 1;
          continue;
        }
      }

      // PER-HOUR HARD CAP — if window expired, reset; if at cap, escalate
      const windowStart = (conv as any).promise_fulfillment_window_start;
      const currentCount = (conv as any).promise_fulfillment_count || 0;
      const windowAgeSec = windowStart ? (Date.now() - new Date(windowStart).getTime()) / 1000 : Infinity;
      const inWindow = windowAgeSec < 3600;
      const effectiveCount = inWindow ? currentCount : 0;

      // Get last assistant + preceding user message
      const { data: lastMsgs } = await supabase
        .from("messages")
        .select("id, role, content, created_at, message_metadata")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: false })
        .limit(8);

      if (!lastMsgs || lastMsgs.length === 0) continue;
      const last = lastMsgs[0];
      if (last.role !== "assistant") continue;
      if (!isPromiseMessage(last.content)) continue;

      const ageSec = Math.floor((Date.now() - new Date(last.created_at).getTime()) / 1000);
      if (ageSec < PROMISE_AGE_MIN_SECONDS) continue;

      const userMsg = lastMsgs.find((m) => m.role === "user" && new Date(m.created_at) < new Date(last.created_at));
      if (!userMsg || !userMsg.content?.trim()) continue;

      stats.candidates += 1;

      // RE-STALL DETECTION — if the last assistant message itself came from a fulfillment attempt
      // and is still a promise, escalate immediately instead of trying again.
      const lastMeta = (last.message_metadata && typeof last.message_metadata === "object")
        ? (last.message_metadata as Record<string, any>) : {};
      const wasFulfillmentOutput = lastMeta.promise_fulfillment === true;

      if (wasFulfillmentOutput || effectiveCount >= MAX_FULFILLMENTS_PER_HOUR) {
        console.log(`[PROMISE-WATCHDOG] conv=${conv.id} action=escalate (wasFulfillmentOutput=${wasFulfillmentOutput} count=${effectiveCount}/${MAX_FULFILLMENTS_PER_HOUR})`);
        await escalateToOwner(supabase, conv, company, userMsg.content);
        stats.escalated += 1;
        stats.paused += 1;
        continue;
      }

      console.log(`[PROMISE-WATCHDOG] conv=${conv.id} promise="${(last.content || '').slice(0, 60)}" age=${ageSec}s action=fulfill (attempt ${effectiveCount + 1}/${MAX_FULFILLMENTS_PER_HOUR})`);

      // Reserve the attempt at conversation level BEFORE invoking
      const nowIso = new Date().toISOString();
      await supabase
        .from("conversations")
        .update({
          last_promise_fulfillment_at: nowIso,
          promise_fulfillment_count: effectiveCount + 1,
          promise_fulfillment_window_start: inWindow ? windowStart : nowIso,
        })
        .eq("id", conv.id);

      try {
        const fromWa = normalizeWhatsApp(conv.phone || "");
        const toWa = normalizeWhatsApp(company.whatsapp_number);
        const resp = await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-messages`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({
              isPromiseFulfillment: true,
              From: fromWa,
              To: toWa,
              Body: userMsg.content,
              ProfileName: conv.customer_name || "",
            }),
          },
        );
        if (!resp.ok) {
          const txt = await resp.text();
          console.error(`[PROMISE-WATCHDOG] fulfill failed conv=${conv.id} status=${resp.status} body=${txt.slice(0, 200)}`);
          stats.escalated += 1;
        } else {
          stats.fulfilled += 1;
        }
      } catch (e) {
        console.error(`[PROMISE-WATCHDOG] fulfill threw conv=${conv.id}`, e);
        stats.escalated += 1;
      }
    }

    const elapsed = Date.now() - startedAt;
    console.log(`[PROMISE-WATCHDOG] done in ${elapsed}ms`, stats);
    return new Response(JSON.stringify({ ok: true, elapsed_ms: elapsed, ...stats }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[PROMISE-WATCHDOG] fatal", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function escalateToOwner(
  supabase: any,
  conv: any,
  company: any,
  customerQuestion: string,
) {
  // 1. Pause the conversation so no further auto-replies fire.
  await supabase
    .from("conversations")
    .update({ is_paused_for_human: true })
    .eq("id", conv.id);

  // 2. Send the customer ONE clean handoff message (via send-whatsapp-message edge function).
  try {
    await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-whatsapp-message`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          to: conv.phone,
          message: "I'm having trouble pulling that up right now — the owner has been notified and will reply shortly.",
          companyId: conv.company_id,
          conversationId: conv.id,
        }),
      },
    );
  } catch (e) {
    console.error(`[PROMISE-WATCHDOG] customer handoff send failed conv=${conv.id}`, e);
  }

  // 3. Notify the owner.
  if (company.boss_phone) {
    try {
      await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-boss-notification`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            companyId: conv.company_id,
            type: "customer_issue",
            message: `Customer ${conv.customer_name || conv.phone} is stuck — AI couldn't fulfill their request after multiple attempts.\n\nCustomer asked: "${customerQuestion.slice(0, 200)}"\n\nConversation paused — please take over.`,
            conversationId: conv.id,
          }),
        },
      );
    } catch (e) {
      console.error(`[PROMISE-WATCHDOG] boss notify failed conv=${conv.id}`, e);
    }
  }
}
