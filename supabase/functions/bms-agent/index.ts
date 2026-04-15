import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadBmsConnection, type BmsConnection } from "../_shared/bms-connection.ts";

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

async function callBMS(
  connection: BmsConnection,
  intent: string,
  params: Record<string, any>
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const { company_id, ...restParams } = params;
    const payload: Record<string, any> = {
      action: intent,
      intent,
      tenant_id: connection.tenant_id,
      omanut_tenant_id: company_id || null,
      ...restParams,
    };

    const attempts = [
      {
        label: "x-api-secret",
        headers: {
          "Content-Type": "application/json",
          "x-api-secret": connection.api_secret,
        },
      },
      {
        label: "authorization-fallback",
        headers: {
          "Content-Type": "application/json",
          "x-api-secret": connection.api_secret,
          "Authorization": `Bearer ${connection.api_secret}`,
        },
      },
    ];

    let lastError = "BMS connection failed";

    for (const attempt of attempts) {
      const res = await fetch(connection.bridge_url, {
        method: "POST",
        headers: attempt.headers,
        body: JSON.stringify(payload),
      });

      const rawBody = await res.text();
      let data: any = {};

      try {
        data = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        data = { raw: rawBody };
      }

      if (res.ok && data.success !== false) {
        return { success: true, data: data.data || data };
      }

      lastError = data.error || data.message || data.raw || `BMS returned status ${res.status}`;
      const normalizedError = String(lastError).toLowerCase();
      const shouldRetryWithAuthorization =
        attempt.label === "x-api-secret" &&
        (normalizedError.includes("missing authorization") || normalizedError.includes("unauthorized"));

      if (!shouldRetryWithAuthorization) {
        return { success: false, error: lastError };
      }

      console.warn(`[BMS-AGENT] ${attempt.label} failed, retrying with Authorization fallback: ${lastError}`);
    }

    return { success: false, error: lastError };
  } catch (err) {
    console.error(`[BMS-AGENT] callBMS(${intent}) error:`, err);
    return { success: false, error: err instanceof Error ? err.message : "BMS connection failed" };
  }
}

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const AVAILABLE_ACTIONS = [
  // Health & Config
  "health_check", "register_omanut_link",
  // Sales & Revenue
  "check_stock", "record_sale", "credit_sale", "get_sales_summary", "get_sales_details",
  // Legacy aliases (mapped above)
  "sales_report", "get_company_statistics",
  // Inventory
  "list_products", "get_product_variants", "update_stock", "low_stock_alerts", "bulk_add_inventory",
  // Legacy alias
  "get_low_stock_items",
  // Customers & Contacts
  "create_contact", "check_customer", "who_owes",
  // Invoices, Quotations & Orders
  "create_invoice", "create_quotation", "create_order",
  "get_order_status", "update_order_status", "cancel_order",
  // Documents
  "send_receipt", "send_invoice", "send_quotation", "send_payslip",
  // HR & Attendance
  "clock_in", "clock_out", "my_attendance", "my_tasks", "my_pay", "my_schedule", "team_attendance",
  // Expenses & Finance
  "record_expense", "get_expenses",
  "get_outstanding_receivables", "get_outstanding_payables", "profit_loss_report",
  // Reports
  "daily_report",
  // Misc
  "get_customer_history", "generate_payment_link", "pending_orders",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, params = {} } = await req.json();

    if (!action) {
      return respond({ success: false, error: "Missing 'action' field" }, 400);
    }

    // Resolve BMS connection for this company
    const companyId = params.company_id;
    let connection: BmsConnection | null = null;

    if (companyId) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      connection = await loadBmsConnection(supabase, companyId);
    }

    if (!connection) {
      // Last resort: try global env fallback without DB
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
        return respond({ success: false, error: "No BMS connection configured for this company" }, 400);
      }
    }

    // Resolve intent: apply aliases for backward compat
    const resolvedIntent = ACTION_ALIASES[action] || action;

    console.log(`[BMS-AGENT] Action: ${action} → Intent: ${resolvedIntent}, Company: ${companyId}, BMS: ${connection.bms_type}, Bridge: ${connection.bridge_url}`);

    if (!AVAILABLE_ACTIONS.includes(action)) {
      return respond({
        success: false,
        error: `Unknown action: ${action}`,
        available_actions: AVAILABLE_ACTIONS,
      }, 400);
    }

    // Forward to BMS with all params (flat payload)
    const result = await callBMS(connection, resolvedIntent, params);

    console.log(`[BMS-AGENT] ${resolvedIntent} result:`, JSON.stringify(result).slice(0, 500));
    return respond(result, result.success ? 200 : 502);
  } catch (err) {
    console.error("[BMS-AGENT] Error:", err);
    return respond(
      { success: false, error: err instanceof Error ? err.message : "Internal error" },
      500
    );
  }
});
