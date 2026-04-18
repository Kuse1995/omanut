import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadBmsConnection, type BmsConnection } from "../_shared/bms-connection.ts";
import {
  classifyHttpError,
  classifyTransportError,
  computeIdempotencyKey,
  isBreakerOpen,
  recordBreakerFailure,
  recordBreakerSuccess,
  sleep,
  BMS_WRITE_INTENTS,
  type BmsErrorCode,
  type BmsResult,
} from "../_shared/bms-error-codes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Map legacy action names to spec-compliant intents
const ACTION_ALIASES: Record<string, string> = {
  sales_report: "get_sales_summary",
  get_low_stock_items: "low_stock_alerts",
  get_company_statistics: "get_sales_summary",
};

// Per-call timeouts: writes need more headroom than reads
const READ_TIMEOUT_MS = 8_000;
const WRITE_TIMEOUT_MS = 15_000;
const HEALTH_TIMEOUT_MS = 4_000;

// Retry budget for transient failures
const MAX_RETRIES = 2;
const BACKOFF_MS = [250, 750];

interface CallOptions {
  companyId: string | null;
  conversationId?: string | null;
  isHealthCheck?: boolean;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function singleAttempt(
  connection: BmsConnection,
  intent: string,
  payload: Record<string, any>,
  timeoutMs: number
): Promise<BmsResult & { http_status?: number; raw?: string }> {
  const attempts = [
    {
      label: "x-api-secret",
      headers: {
        "Content-Type": "application/json",
        "x-api-secret": connection.api_secret,
      } as Record<string, string>,
    },
    {
      label: "authorization-fallback",
      headers: {
        "Content-Type": "application/json",
        "x-api-secret": connection.api_secret,
        "Authorization": `Bearer ${connection.api_secret}`,
      } as Record<string, string>,
    },
  ];

  let lastResult: BmsResult & { http_status?: number; raw?: string } = {
    success: false,
    code: "UNKNOWN",
    message: "BMS connection failed",
    retriable: false,
  };

  for (const attempt of attempts) {
    try {
      const res = await fetchWithTimeout(
        connection.bridge_url,
        { method: "POST", headers: attempt.headers, body: JSON.stringify(payload) },
        timeoutMs
      );
      const rawBody = await res.text();
      let data: any = {};
      try { data = rawBody ? JSON.parse(rawBody) : {}; } catch { data = { raw: rawBody }; }

      if (res.ok && data.success !== false) {
        return { success: true, code: "OK", data: data.data ?? data, http_status: res.status };
      }

      const errMsg = data.error || data.message || data.raw || `BMS returned status ${res.status}`;
      const cls = classifyHttpError(res.status, errMsg);
      lastResult = {
        success: false,
        code: cls.code,
        message: errMsg,
        retriable: cls.retriable,
        hint: cls.hint,
        http_status: res.status,
      };

      // Auth retry: only if the FIRST attempt complained about authorization
      const isAuthIssue = cls.code === "AUTH_FAILED" &&
        (errMsg.toLowerCase().includes("missing authorization") || errMsg.toLowerCase().includes("unauthorized"));
      if (attempt.label === "x-api-secret" && isAuthIssue) {
        console.warn(`[BMS-AGENT] auth header retry: ${errMsg}`);
        continue;
      }
      return lastResult;
    } catch (err) {
      const cls = classifyTransportError(err);
      lastResult = {
        success: false,
        code: cls.code,
        message: err instanceof Error ? err.message : "transport error",
        retriable: cls.retriable,
        hint: cls.hint,
      };
      return lastResult;
    }
  }
  return lastResult;
}

async function callBMS(
  connection: BmsConnection,
  intent: string,
  params: Record<string, any>,
  opts: CallOptions
): Promise<BmsResult & { latency_ms?: number; attempts?: number }> {
  const { company_id, conversation_id: _conv, ...restParams } = params;
  const isWrite = BMS_WRITE_INTENTS.has(intent);
  const timeoutMs = opts.isHealthCheck ? HEALTH_TIMEOUT_MS : (isWrite ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS);

  // Circuit breaker: fail fast if the BMS for this company is known-down
  if (opts.companyId && isBreakerOpen(opts.companyId)) {
    return {
      success: false,
      code: "CIRCUIT_OPEN",
      message: "BMS is temporarily unavailable (circuit open)",
      retriable: true,
      hint: "BMS recently failed multiple times in a row; backing off for 30s",
    };
  }

  // Idempotency: for writes, check the cache first; on first call insert in_flight row
  let idempotencyKey: string | null = null;
  let supabaseAdmin: any = null;
  if (isWrite && opts.companyId) {
    supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    idempotencyKey = await computeIdempotencyKey(opts.companyId, opts.conversationId ?? null, intent, restParams);

    const { data: existing } = await supabaseAdmin
      .from("bms_write_log")
      .select("status, result")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existing && existing.status === "success" && existing.result) {
      console.log(`[BMS-AGENT] idempotency hit for ${intent} (key=${idempotencyKey.slice(0, 12)}…) — returning cached result`);
      return existing.result as BmsResult;
    }

    // Insert in_flight (best effort — ignore conflicts since another worker may have raced)
    await supabaseAdmin.from("bms_write_log").upsert({
      idempotency_key: idempotencyKey,
      company_id: opts.companyId,
      conversation_id: opts.conversationId ?? null,
      intent,
      params: restParams,
      status: "in_flight",
    }, { onConflict: "idempotency_key", ignoreDuplicates: true });
  }

  const payload: Record<string, any> = {
    action: intent,
    intent,
    tenant_id: connection.tenant_id,
    omanut_tenant_id: company_id || null,
    ...restParams,
  };
  if (idempotencyKey) {
    payload.idempotency_key = idempotencyKey;
  }

  const startedAt = Date.now();
  let attempts = 0;
  let result: BmsResult & { http_status?: number };

  while (true) {
    attempts++;
    result = await singleAttempt(connection, intent, payload, timeoutMs);
    if (result.success || !("retriable" in result) || !result.retriable || attempts > MAX_RETRIES) {
      break;
    }
    const wait = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
    console.warn(`[BMS-AGENT] ${intent} attempt ${attempts} failed (${(result as any).code}); retrying in ${wait}ms`);
    await sleep(wait);
  }

  const latency_ms = Date.now() - startedAt;

  // Update breaker state
  if (opts.companyId) {
    if (result.success) recordBreakerSuccess(opts.companyId);
    else recordBreakerFailure(opts.companyId);
  }

  // Update idempotency log
  if (idempotencyKey && supabaseAdmin) {
    await supabaseAdmin
      .from("bms_write_log")
      .update({
        status: result.success ? "success" : "failure",
        result,
        completed_at: new Date().toISOString(),
      })
      .eq("idempotency_key", idempotencyKey);
  }

  // Log call to bms_call_log (best effort, don't block)
  if (opts.companyId && !opts.isHealthCheck) {
    try {
      const admin = supabaseAdmin ?? createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      const excerpt = result.success
        ? JSON.stringify((result as any).data).slice(0, 500)
        : (result as any).message?.slice(0, 500);
      admin.from("bms_call_log").insert({
        company_id: opts.companyId,
        conversation_id: opts.conversationId ?? null,
        intent,
        params: restParams,
        success: result.success,
        error_code: result.success ? null : (result as any).code,
        error_message: result.success ? null : (result as any).message,
        latency_ms,
        attempts,
        response_excerpt: excerpt,
      }).then(({ error }: any) => {
        if (error) console.error("[BMS-AGENT] call log insert failed:", error.message);
      });
    } catch (e) {
      console.error("[BMS-AGENT] call log error:", e);
    }
  }

  return { ...result, latency_ms, attempts };
}

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const AVAILABLE_ACTIONS = [
  "health_check", "register_omanut_link",
  "check_stock", "record_sale", "credit_sale", "get_sales_summary", "get_sales_details",
  "sales_report", "get_company_statistics",
  "list_products", "get_product_variants", "update_stock", "low_stock_alerts", "bulk_add_inventory",
  "get_low_stock_items",
  "create_contact", "check_customer", "who_owes",
  "create_invoice", "create_quotation", "create_order",
  "get_order_status", "update_order_status", "cancel_order",
  "send_receipt", "send_invoice", "send_quotation", "send_payslip",
  "clock_in", "clock_out", "my_attendance", "my_tasks", "my_pay", "my_schedule", "team_attendance",
  "record_expense", "get_expenses",
  "get_outstanding_receivables", "get_outstanding_payables", "profit_loss_report",
  "daily_report",
  "get_customer_history", "generate_payment_link", "pending_orders",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, params = {}, conversation_id = null, health_check = false } = body;

    if (!action) {
      return respond({ success: false, code: "VALIDATION", error: "Missing 'action' field" }, 400);
    }

    const companyId: string | null = params.company_id ?? null;
    let connection: BmsConnection | null = null;

    if (companyId) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      connection = await loadBmsConnection(supabase, companyId);
    }

    if (!connection) {
      const globalSecret = Deno.env.get("BMS_API_SECRET");
      if (globalSecret) {
        connection = {
          bridge_url: "https://hnyzymyfirumjclqheit.supabase.co/functions/v1/bms-api-bridge",
          api_secret: globalSecret,
          bms_type: "single_tenant",
          tenant_id: null,
          is_active: true,
        };
      } else {
        return respond({ success: false, code: "VALIDATION", error: "No BMS connection configured for this company" }, 400);
      }
    }

    const resolvedIntent = ACTION_ALIASES[action] || action;

    console.log(`[BMS-AGENT] Action: ${action} → Intent: ${resolvedIntent}, Company: ${companyId}, BMS: ${connection.bms_type}, Bridge: ${connection.bridge_url}`);

    if (!AVAILABLE_ACTIONS.includes(action)) {
      return respond({
        success: false,
        code: "VALIDATION",
        error: `Unknown action: ${action}`,
        available_actions: AVAILABLE_ACTIONS,
      }, 400);
    }

    const result = await callBMS(connection, resolvedIntent, params, {
      companyId,
      conversationId: conversation_id,
      isHealthCheck: health_check === true || resolvedIntent === "health_check",
    });

    console.log(`[BMS-AGENT] ${resolvedIntent} result: success=${result.success} code=${(result as any).code} latency=${(result as any).latency_ms}ms attempts=${(result as any).attempts}`);
    return respond(result, result.success ? 200 : 502);
  } catch (err) {
    console.error("[BMS-AGENT] Error:", err);
    return respond(
      { success: false, code: "UNKNOWN", error: err instanceof Error ? err.message : "Internal error" },
      500
    );
  }
});
