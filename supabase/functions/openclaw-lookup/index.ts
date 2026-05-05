// OpenClaw lookup endpoint: agent calls this to fetch live BMS data or search KB.
// Auth via shared HMAC secret (same as openclaw-reply / openclaw-dispatch).
import { createClient } from "npm:@supabase/supabase-js@2";
import { loadBmsConnection, type BmsConnection } from "../_shared/bms-connection.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-openclaw-signature",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function verifySignature(rawBody: string, sigHeader: string | null, secret: string): Promise<boolean> {
  if (!secret) return true; // dev fallback if secret not configured
  if (!sigHeader) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const expected = "sha256=" + Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  // constant-time-ish compare
  if (expected.length !== sigHeader.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ sigHeader.charCodeAt(i);
  return mismatch === 0;
}

async function callBMS(connection: BmsConnection, intent: string, params: Record<string, unknown> = {}) {
  try {
    const payload = { action: intent, intent, tenant_id: connection.tenant_id, ...params };
    const res = await fetch(connection.bridge_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-secret": connection.api_secret,
        "Authorization": `Bearer ${connection.api_secret}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000),
    });
    const txt = await res.text();
    let data: any = {};
    try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }
    if (res.ok && data.success !== false) return { success: true, data: data.data ?? data };
    return { success: false, error: data.error || data.message || `BMS status ${res.status}` };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "BMS connection failed" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const rawBody = await req.text();
  const sig = req.headers.get("x-openclaw-signature");
  const secret = Deno.env.get("OPENCLAW_WEBHOOK_SECRET") ?? "";
  if (!(await verifySignature(rawBody, sig, secret))) {
    return json({ error: "invalid_signature" }, 401);
  }

  let body: any;
  try { body = JSON.parse(rawBody); } catch { return json({ error: "invalid_json" }, 400); }

  const { company_id, intent, query } = body ?? {};
  if (!company_id || !intent) return json({ error: "missing_fields", required: ["company_id", "intent"] }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // KB SEARCH: scan company quick_reference_info + parsed documents using ILIKE on the query terms.
  if (intent === "search_kb") {
    const q = String(query ?? "").trim();
    if (!q) return json({ error: "missing_query" }, 400);

    const { data: company } = await supabase
      .from("companies")
      .select("name, quick_reference_info, payment_instructions, services, hours, business_type")
      .eq("id", company_id)
      .maybeSingle();

    const { data: docs } = await supabase
      .from("company_documents")
      .select("filename, parsed_content")
      .eq("company_id", company_id)
      .limit(20);

    // Naive but effective: split query into keywords, find paragraphs that contain any keyword.
    const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    const matches: Array<{ source: string; snippet: string; score: number }> = [];

    const scan = (source: string, text: string | null | undefined) => {
      if (!text) return;
      const paragraphs = text.split(/\n{2,}|\r\n\r\n/);
      for (const p of paragraphs) {
        const lower = p.toLowerCase();
        let score = 0;
        for (const t of terms) if (lower.includes(t)) score++;
        if (score > 0) matches.push({ source, snippet: p.trim().slice(0, 800), score });
      }
    };

    scan("quick_reference_info", company?.quick_reference_info);
    scan("payment_instructions", company?.payment_instructions);
    scan("services", company?.services);
    scan("hours", company?.hours);
    for (const d of docs ?? []) scan(`document:${d.filename}`, d.parsed_content);

    matches.sort((a, b) => b.score - a.score);
    return json({
      success: true,
      query: q,
      company_name: company?.name ?? null,
      results: matches.slice(0, 8),
      result_count: matches.length,
    });
  }

  // BMS intents
  const bmsIntents = new Set(["check_stock", "list_products", "get_sales_summary", "low_stock_alerts", "search_products", "get_pricing"]);
  if (bmsIntents.has(intent)) {
    const conn = await loadBmsConnection(supabase, company_id);
    if (!conn) return json({ success: false, error: "no_bms_connection" }, 200);
    // Map get_pricing → list_products (price is included in list_products)
    const realIntent = intent === "get_pricing" ? "list_products" : intent;
    const params: Record<string, unknown> = { company_id };
    if (query) params.query = query;
    const res = await callBMS(conn, realIntent, params);
    return json({ success: res.success, intent: realIntent, query: query ?? null, ...res });
  }

  return json({ error: "unknown_intent", intent, supported: ["search_kb", "check_stock", "list_products", "get_sales_summary", "low_stock_alerts", "search_products", "get_pricing"] }, 400);
});
