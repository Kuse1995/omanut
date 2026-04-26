import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Find conversations with deep engagement that have NOT been escalated to the boss
// and NOT closed by a sale, then send a single boss alert per conversation.
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const MIN_USER_MESSAGES = 8;
    const ACTIVE_WINDOW_HOURS = 2;
    const DEDUPE_WINDOW_HOURS = 24;

    const sinceActive = new Date(Date.now() - ACTIVE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    const sinceDedupe = new Date(Date.now() - DEDUPE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

    // Pull recent active conversations
    const { data: convos, error: cErr } = await supabase
      .from("conversations")
      .select("id, company_id, customer_name, phone, last_message_at, last_message_preview, platform, started_at")
      .gte("last_message_at", sinceActive)
      .eq("archived", false)
      .limit(500);

    if (cErr) throw cErr;
    if (!convos?.length) {
      return new Response(JSON.stringify({ ok: true, scanned: 0, alerted: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let alerted = 0;
    let skippedDedupe = 0;
    let skippedShort = 0;

    for (const c of convos) {
      // Count user messages
      const { count: userCount } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", c.id)
        .eq("role", "user");

      if (!userCount || userCount < MIN_USER_MESSAGES) {
        skippedShort++;
        continue;
      }

      // Already alerted recently? (any boss_conversations row referencing this conv)
      const { data: priorAlert } = await supabase
        .from("boss_conversations")
        .select("id")
        .eq("company_id", c.company_id)
        .ilike("message_content", `%${c.id}%`)
        .gte("created_at", sinceDedupe)
        .limit(1)
        .maybeSingle();

      if (priorAlert) {
        skippedDedupe++;
        continue;
      }

      // Sale already closed for this conversation? skip
      const { data: sale } = await supabase
        .from("bms_write_log")
        .select("id")
        .eq("company_id", c.company_id)
        .eq("conversation_id", c.id)
        .eq("intent", "record_sale")
        .eq("status", "completed")
        .limit(1)
        .maybeSingle();

      if (sale) {
        skippedDedupe++;
        continue;
      }

      // Send boss alert
      const customer = c.customer_name || c.phone || "Unknown";
      const preview = (c.last_message_preview || "").toString().slice(0, 200);
      const startedAt = c.started_at ? new Date(c.started_at) : null;
      const duration = startedAt
        ? `${Math.round((Date.now() - startedAt.getTime()) / 60000)} min`
        : "unknown duration";

      try {
        await supabase.functions.invoke("send-boss-notification", {
          body: {
            companyId: c.company_id,
            notificationType: "high_value_opportunity",
            data: {
              customer_name: customer,
              customer_phone: c.phone || "unknown",
              opportunity_type: `Long unresolved lead — ${userCount} customer messages over ${duration}`,
              details: `This customer has been chatting for a while and the AI hasn't escalated yet. Please review.\n\nLast message: "${preview}"\n\nPlatform: ${c.platform || "whatsapp"}\nConv: ${c.id.slice(0, 8)}`,
              estimated_value: "Unknown — please review",
            },
          },
        });

        // Marker for dedupe
        await supabase.from("boss_conversations").insert({
          company_id: c.company_id,
          message_from: "system",
          message_content: `Engagement watchdog alert [${c.id}]: ${userCount} user msgs, no escalation`,
          response: preview,
        });

        alerted++;
      } catch (sendErr) {
        console.error(`[engagement-watchdog] Failed to alert for conv ${c.id}:`, sendErr);
      }
    }

    console.log(`[engagement-watchdog] scanned=${convos.length} alerted=${alerted} dedupe=${skippedDedupe} short=${skippedShort}`);

    return new Response(
      JSON.stringify({ ok: true, scanned: convos.length, alerted, skippedDedupe, skippedShort }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[engagement-watchdog] Error:", error);
    return new Response(JSON.stringify({ error: "Watchdog failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
