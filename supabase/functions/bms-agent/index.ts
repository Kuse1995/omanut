import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BMS_BRIDGE_URL = "https://hnyzymyfirumjclqheit.supabase.co/functions/v1/bms-api-bridge";

async function callBMS(action: string, params: Record<string, any>): Promise<{ success: boolean; data?: any; error?: string }> {
  const BMS_API_SECRET = Deno.env.get("BMS_API_SECRET");
  if (!BMS_API_SECRET) {
    return { success: false, error: "BMS_API_SECRET not configured" };
  }

  try {
    const res = await fetch(BMS_BRIDGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${BMS_API_SECRET}`,
      },
      body: JSON.stringify({ action, ...params }),
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, params = {} } = await req.json();

    if (!action) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing 'action' field" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[BMS-AGENT] Action: ${action}, Params:`, JSON.stringify(params));

    let result: { success: boolean; data?: any; error?: string };

    switch (action) {
      case "check_stock": {
        if (!params.product_name) {
          return respond({ success: false, error: "product_name is required" }, 400);
        }
        result = await callBMS("check_stock", {
          product_name: params.product_name,
          company_id: params.company_id,
        });
        break;
      }

      case "record_sale": {
        if (!params.product_name || !params.quantity) {
          return respond({ success: false, error: "product_name and quantity are required" }, 400);
        }
        result = await callBMS("record_sale", {
          product_name: params.product_name,
          quantity: params.quantity,
          payment_method: params.payment_method || null,
          customer_name: params.customer_name || null,
          customer_phone: params.customer_phone || null,
          company_id: params.company_id,
        });
        break;
      }

      case "generate_payment_link": {
        if (!params.amount || !params.customer_name) {
          return respond({ success: false, error: "amount and customer_name are required" }, 400);
        }
        result = await callBMS("generate_payment_link", {
          amount: params.amount,
          customer_name: params.customer_name,
          customer_phone: params.customer_phone || null,
          reference: params.reference || null,
          company_id: params.company_id,
        });
        break;
      }

      case "list_products": {
        result = await callBMS("list_products", {
          company_id: params.company_id,
        });
        break;
      }

      case "get_product_details": {
        if (!params.product_name) {
          return respond({ success: false, error: "product_name is required" }, 400);
        }
        // Fetch from BMS — the BMS bridge returns product info including image_urls when available
        result = await callBMS("get_product_details", {
          product_name: params.product_name,
          company_id: params.company_id,
        });

        // If BMS doesn't support get_product_details yet, fall back to check_stock
        if (!result.success && result.error?.includes("Unknown action")) {
          console.log("[BMS-AGENT] get_product_details not supported, falling back to check_stock");
          result = await callBMS("check_stock", {
            product_name: params.product_name,
            company_id: params.company_id,
          });
        }
        break;
      }

      case "update_stock": {
        if (!params.product_name || params.quantity === undefined) {
          return respond({ success: false, error: "product_name and quantity are required" }, 400);
        }
        result = await callBMS("update_stock", {
          product_name: params.product_name,
          quantity: params.quantity,
          adjustment_type: params.adjustment_type || "set", // "set", "add", "subtract"
          reason: params.reason || null,
          company_id: params.company_id,
        });
        break;
      }

      case "sales_report": {
        result = await callBMS("sales_report", {
          period: params.period || "today", // "today", "week", "month"
          company_id: params.company_id,
        });
        break;
      }

      default:
        return respond({
          success: false,
          error: `Unknown action: ${action}`,
          available_actions: [
            "check_stock",
            "record_sale",
            "generate_payment_link",
            "list_products",
            "get_product_details",
            "update_stock",
            "sales_report",
          ],
        }, 400);
    }

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

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
