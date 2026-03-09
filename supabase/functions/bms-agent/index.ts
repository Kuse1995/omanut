import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadBmsConnection, type BmsConnection } from "../_shared/bms-connection.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function callBMS(
  connection: BmsConnection,
  action: string,
  params: Record<string, any>
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    // For multi-tenant, inject tenant_id into payload
    const payload: Record<string, any> = { action, ...params };
    if (connection.bms_type === "multi_tenant" && connection.tenant_id) {
      payload.tenant_id = connection.tenant_id;
    }

    const res = await fetch(connection.bridge_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${connection.api_secret}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      return { success: false, error: data.error || data.message || `BMS returned status ${res.status}` };
    }

    return { success: true, data: data.data || data };
  } catch (err) {
    console.error(`[BMS-AGENT] callBMS(${action}) error:`, err);
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
  "check_stock", "record_sale", "generate_payment_link", "list_products",
  "get_product_details", "get_product_variants", "update_stock", "sales_report",
  "create_order", "get_order_status", "update_order_status", "cancel_order",
  "get_customer_history", "get_company_statistics", "create_quotation",
  "create_invoice", "list_quotations", "list_invoices", "get_low_stock_items",
  "record_expense", "get_expenses", "get_outstanding_receivables",
  "get_outstanding_payables", "profit_loss_report", "clock_in", "clock_out",
  "create_contact",
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

    console.log(`[BMS-AGENT] Action: ${action}, Company: ${companyId}, BMS: ${connection.bms_type}, Bridge: ${connection.bridge_url}`);

    if (!AVAILABLE_ACTIONS.includes(action)) {
      return respond({
        success: false,
        error: `Unknown action: ${action}`,
        available_actions: AVAILABLE_ACTIONS,
      }, 400);
    }

    // Forward to BMS with all params
    const result = await callBMS(connection, action, params);

    console.log(`[BMS-AGENT] ${action} result:`, JSON.stringify(result).slice(0, 500));
    return respond(result, result.success ? 200 : 502);
  } catch (err) {
    console.error("[BMS-AGENT] Error:", err);
    return respond(
      { success: false, error: err instanceof Error ? err.message : "Internal error" },
      500
    );
  }
});
