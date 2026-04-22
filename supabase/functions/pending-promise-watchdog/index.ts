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
];

// The synthesis-fallback signature — short message ending with hourglass/folded-hands/magnifier.
const FALLBACK_SIGNATURE = /[…\.]{0,3}\s*[🙏🔍⏳]\s*$/;

function isPromiseMessage(content: string): boolean {
  if (!content) return false;
  const trimmed = content.trim();
  if (PROMISE_PATTERNS.some((re) => re.test(trimmed))) return true;
  if (trimmed.length < 80 && FALLBACK_SIGNATURE.test(trimmed)) return true;
  return false;
}

function normalizeWhatsApp(phone: string): string {
  if (!phone) return "";
  return phone.startsWith("whatsapp:") ? phone : `whatsapp:${phone.startsWith("+") ? phone : `+${phone.replace(/^\+/, "")}`}`;
}

const PROMISE_AGE_MIN_SECONDS = 90;          // wait at least 90s before declaring abandoned
const PROMISE_AGE_MAX_SECONDS = 15 * 60;     // ignore anything older than 15 min (covers our scan window)
const COOLDOWN_SECONDS = 10 * 60;            // don't retry the same promise more than once per 10 min
const MAX_FULFILLMENTS_PER_RUN = 5;          // global cap per cron tick

function getMeta(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const startedAt = Date.now();
  const stats = { scanned: 0, candidates: 0, fulfilled: 0, escalated: 0, skipped: 0 };

  try {
    // 1. Pull active conversations with recent activity.
    const cutoff = new Date(Date.now() - PROMISE_AGE_MAX_SECONDS * 1000).toISOString();
    const { data: convs, error: convErr } = await supabase
      .from("conversations")
      .select("id, company_id, phone, customer_name, last_message_at, status, human_takeover, is_paused_for_human, companies!inner(whatsapp_number)")
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

      // 2. Get last assistant message and the user message that preceded it.
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

      // Find the most recent user message before the promise.
      const userMsg = lastMsgs.find((m) => m.role === "user" && new Date(m.created_at) < new Date(last.created_at));
      if (!userMsg || !userMsg.content?.trim()) continue;

      const lastMeta = getMeta((last as any).message_metadata);
      const userMeta = getMeta((userMsg as any).message_metadata);

      stats.candidates += 1;

      // 3. Cooldown / loop guard via assistant-message metadata.
      const lastAttempt = lastMeta.promise_fulfillment_attempted_at as string | undefined;
      if (lastAttempt) {
        const sinceAttempt = (Date.now() - new Date(lastAttempt).getTime()) / 1000;
        if (sinceAttempt < COOLDOWN_SECONDS) {
          console.log(`[PROMISE-WATCHDOG] conv=${conv.id} phone=${conv.phone} age=${ageSec}s action=skip (cooldown, attempted_at=${lastAttempt})`);
          stats.skipped += 1;
          continue;
        }

        console.log(`[PROMISE-WATCHDOG] conv=${conv.id} phone=${conv.phone} age=${ageSec}s action=skip (already-attempted)`);
        stats.skipped += 1;
        continue;
      }

      if (userMeta.promise_fulfillment === true) {
        console.log(`[PROMISE-WATCHDOG] conv=${conv.id} phone=${conv.phone} age=${ageSec}s action=skip (promise-generated-turn-stalled-again)`);
        stats.escalated += 1;
        continue;
      }

      console.log(`[PROMISE-WATCHDOG] conv=${conv.id} phone=${conv.phone} promise="${(last.content || '').slice(0, 60)}" age=${ageSec}s action=fulfill`);

      // 4. Mark the attempt BEFORE invoking, to avoid double-fire on slow runs.
      const attemptAt = new Date().toISOString();
      await supabase
        .from("messages")
        .update({
          message_metadata: {
            ...lastMeta,
            promise_fulfillment_attempted_at: attemptAt,
            promise_watchdog: true,
          },
        })
        .eq("id", last.id);

      // 5. Re-invoke whatsapp-messages with the original user question + fulfillment flag.
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
