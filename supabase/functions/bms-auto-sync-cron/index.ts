import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BMS_SYNC_START = "<!-- BMS_SYNC_START -->";
const BMS_SYNC_END = "<!-- BMS_SYNC_END -->";
const COOLDOWN_MINUTES = 10;

function applyToKb(existing: string, formatted: string): string {
  const wrapped = `${BMS_SYNC_START}\n${formatted}\n${BMS_SYNC_END}`;
  if (!existing) return wrapped;
  const startIdx = existing.indexOf(BMS_SYNC_START);
  const endIdx = existing.indexOf(BMS_SYNC_END);
  if (startIdx !== -1 && endIdx !== -1) {
    return existing.slice(0, startIdx) + wrapped + existing.slice(endIdx + BMS_SYNC_END.length);
  }
  return `${existing}\n\n${wrapped}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Optional override: { company_id } to force-sync a single company immediately
  let forceCompanyId: string | null = null;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      forceCompanyId = body?.company_id ?? null;
    }
  } catch {
    /* ignore */
  }

  const cutoff = new Date(Date.now() - COOLDOWN_MINUTES * 60 * 1000).toISOString();

  let query = supabase
    .from("bms_connections")
    .select("company_id, last_bms_sync_at")
    .eq("is_active", true);

  if (forceCompanyId) {
    query = query.eq("company_id", forceCompanyId);
  }

  const { data: connections, error } = await query;

  if (error) {
    console.error("[BMS-AUTO-SYNC] Failed to load connections:", error.message);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: Array<Record<string, unknown>> = [];

  for (const conn of connections ?? []) {
    if (!forceCompanyId && conn.last_bms_sync_at && conn.last_bms_sync_at > cutoff) {
      results.push({ company_id: conn.company_id, skipped: "cooldown" });
      continue;
    }

    try {
      const { data: syncData, error: syncErr } = await supabase.functions.invoke(
        "bms-training-sync",
        { body: { company_id: conn.company_id } },
      );

      if (syncErr || !syncData?.success) {
        results.push({
          company_id: conn.company_id,
          ok: false,
          error: syncErr?.message || syncData?.error || "sync failed",
        });
        continue;
      }

      const formatted = syncData.formatted_text as string;
      if (formatted && formatted.trim()) {
        const { data: company } = await supabase
          .from("companies")
          .select("quick_reference_info")
          .eq("id", conn.company_id)
          .maybeSingle();

        const newKb = applyToKb(company?.quick_reference_info ?? "", formatted);

        await supabase
          .from("companies")
          .update({ quick_reference_info: newKb, updated_at: new Date().toISOString() })
          .eq("id", conn.company_id);
      }

      await supabase
        .from("bms_connections")
        .update({ last_bms_sync_at: new Date().toISOString() })
        .eq("company_id", conn.company_id);

      results.push({ company_id: conn.company_id, ok: true, counts: syncData.counts });
    } catch (err) {
      results.push({
        company_id: conn.company_id,
        ok: false,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  console.log(`[BMS-AUTO-SYNC] Processed ${results.length} companies`);

  return new Response(JSON.stringify({ success: true, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
