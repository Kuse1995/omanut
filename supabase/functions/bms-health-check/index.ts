/**
 * BMS health check cron — pings each company's BMS connection every 5 min,
 * writes the result to bms_health_log so OpenClaw + dashboards can spot outages
 * before customers do.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: connections, error } = await supabase
    .from("bms_connections")
    .select("company_id")
    .eq("is_active", true);

  if (error) {
    console.error("[BMS-HEALTH-CHECK] Could not list connections:", error.message);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: any[] = [];

  for (const conn of connections || []) {
    const startedAt = Date.now();
    try {
      const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/bms-agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          action: "health_check",
          health_check: true,
          params: { company_id: conn.company_id },
        }),
      });
      const data = await res.json();
      const latency = Date.now() - startedAt;
      const status = data.success ? "healthy" : (data.code === "BMS_DOWN" || data.code === "TIMEOUT" || data.code === "NETWORK" ? "down" : "degraded");

      await supabase.from("bms_health_log").insert({
        company_id: conn.company_id,
        status,
        latency_ms: latency,
        error_code: data.success ? null : data.code,
        error_message: data.success ? null : data.message,
      });
      results.push({ company_id: conn.company_id, status, latency_ms: latency });
    } catch (e) {
      const latency = Date.now() - startedAt;
      const msg = e instanceof Error ? e.message : String(e);
      await supabase.from("bms_health_log").insert({
        company_id: conn.company_id,
        status: "down",
        latency_ms: latency,
        error_code: "NETWORK",
        error_message: msg,
      });
      results.push({ company_id: conn.company_id, status: "down", error: msg });
    }
  }

  return new Response(JSON.stringify({ success: true, checked: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
