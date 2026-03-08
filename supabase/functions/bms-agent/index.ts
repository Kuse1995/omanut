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
          adjustment_type: params.adjustment_type || "set",
          reason: params.reason || null,
          company_id: params.company_id,
        });
        break;
      }

      case "sales_report": {
        result = await callBMS("sales_report", {
          period: params.period || "today",
          date_from: params.date_from || null,
          date_to: params.date_to || null,
          group_by: params.group_by || null,
          company_id: params.company_id,
        });
        break;
      }

      case "get_product_variants": {
        if (!params.product_id && !params.product_name) {
          return respond({ success: false, error: "product_id or product_name is required" }, 400);
        }
        result = await callBMS("get_product_variants", {
          product_id: params.product_id || null,
          product_name: params.product_name || null,
          variant_type: params.variant_type || null,
          company_id: params.company_id,
        });
        break;
      }

      case "create_order": {
        if (!params.customer_name || !params.customer_phone || !params.items) {
          return respond({ success: false, error: "customer_name, customer_phone, and items are required" }, 400);
        }
        result = await callBMS("create_order", {
          customer_name: params.customer_name,
          customer_phone: params.customer_phone,
          customer_email: params.customer_email || null,
          items: params.items,
          payment_method: params.payment_method || null,
          delivery_address: params.delivery_address || null,
          notes: params.notes || null,
          company_id: params.company_id,
        });
        break;
      }

      case "get_order_status": {
        if (!params.order_number && !params.order_id) {
          return respond({ success: false, error: "order_number or order_id is required" }, 400);
        }
        result = await callBMS("get_order_status", {
          order_number: params.order_number || null,
          order_id: params.order_id || null,
          company_id: params.company_id,
        });
        break;
      }

      case "update_order_status": {
        if (!params.order_id || !params.status) {
          return respond({ success: false, error: "order_id and status are required" }, 400);
        }
        result = await callBMS("update_order_status", {
          order_id: params.order_id,
          order_number: params.order_number || null,
          status: params.status,
          notes: params.notes || null,
          company_id: params.company_id,
        });
        break;
      }

      case "cancel_order": {
        if (!params.order_id && !params.order_number) {
          return respond({ success: false, error: "order_id or order_number is required" }, 400);
        }
        result = await callBMS("cancel_order", {
          order_id: params.order_id || null,
          order_number: params.order_number || null,
          reason: params.reason || null,
          company_id: params.company_id,
        });
        break;
      }

      case "get_customer_history": {
        if (!params.customer_name && !params.customer_phone) {
          return respond({ success: false, error: "customer_name or customer_phone is required" }, 400);
        }
        result = await callBMS("get_customer_history", {
          customer_name: params.customer_name || null,
          customer_phone: params.customer_phone || null,
          date_from: params.date_from || null,
          date_to: params.date_to || null,
          company_id: params.company_id,
        });
        break;
      }

      case "get_company_statistics": {
        result = await callBMS("get_company_statistics", {
          company_id: params.company_id,
        });
        break;
      }

      case "create_quotation": {
        if (!params.client_name || !params.items) {
          return respond({ success: false, error: "client_name and items are required" }, 400);
        }
        result = await callBMS("create_quotation", {
          client_name: params.client_name,
          items: params.items,
          client_email: params.client_email || null,
          client_phone: params.client_phone || null,
          notes: params.notes || null,
          tax_rate: params.tax_rate || null,
          validity_days: params.validity_days || null,
          company_id: params.company_id,
        });
        break;
      }

      case "create_invoice": {
        if (!params.client_name || !params.items) {
          return respond({ success: false, error: "client_name and items are required" }, 400);
        }
        result = await callBMS("create_invoice", {
          client_name: params.client_name,
          items: params.items,
          client_email: params.client_email || null,
          client_phone: params.client_phone || null,
          due_date: params.due_date || null,
          tax_rate: params.tax_rate || null,
          notes: params.notes || null,
          payment_terms: params.payment_terms || null,
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
            "get_product_variants",
            "update_stock",
            "sales_report",
            "create_order",
            "get_order_status",
            "update_order_status",
            "cancel_order",
            "get_customer_history",
            "get_company_statistics",
            "create_quotation",
            "create_invoice",
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
