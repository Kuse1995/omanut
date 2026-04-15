import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadBmsConnection, type BmsConnection } from "../_shared/bms-connection.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callBMS(
  connection: BmsConnection,
  intent: string,
  params: Record<string, any> = {}
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const payload: Record<string, any> = {
      action: intent,
      intent,
      tenant_id: connection.tenant_id,
      ...params,
    };

    const res = await fetch(connection.bridge_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-secret": connection.api_secret,
        "Authorization": `Bearer ${connection.api_secret}`,
      },
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
    return { success: false, error: data.error || data.message || `BMS status ${res.status}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "BMS connection failed" };
  }
}

function formatProducts(data: any): { text: string; count: number } {
  if (!data || !Array.isArray(data)) return { text: "", count: 0 };
  
  const lines: string[] = [];
  for (const p of data) {
    const name = p.name || p.product_name || p.title || "Unknown";
    const price = p.price || p.selling_price || p.unit_price || "N/A";
    const stock = p.stock ?? p.quantity ?? p.stock_quantity ?? "";
    const category = p.category || p.group || "";
    
    let line = `- ${name}: ${price}`;
    if (stock !== "") line += ` (Stock: ${stock})`;
    if (category) line += ` [${category}]`;
    lines.push(line);
  }
  
  return { text: lines.join("\n"), count: data.length };
}

function formatStockAlerts(data: any): { text: string; count: number } {
  if (!data || !Array.isArray(data)) return { text: "", count: 0 };
  
  const lines: string[] = [];
  for (const item of data) {
    const name = item.name || item.product_name || "Unknown";
    const stock = item.stock ?? item.quantity ?? item.current_stock ?? 0;
    const min = item.min_stock ?? item.reorder_level ?? "";
    let line = `- ⚠️ ${name}: ${stock} remaining`;
    if (min !== "") line += ` (min: ${min})`;
    lines.push(line);
  }
  
  return { text: lines.join("\n"), count: data.length };
}

function formatSalesSummary(data: any): string {
  if (!data) return "";
  
  const lines: string[] = [];
  if (data.total_sales !== undefined) lines.push(`- Total Sales: ${data.total_sales}`);
  if (data.total_revenue !== undefined) lines.push(`- Total Revenue: ${data.total_revenue}`);
  if (data.total_orders !== undefined) lines.push(`- Total Orders: ${data.total_orders}`);
  if (data.period) lines.push(`- Period: ${data.period}`);
  
  // Handle top products if present
  if (data.top_products && Array.isArray(data.top_products)) {
    lines.push("- Top Products:");
    for (const tp of data.top_products.slice(0, 5)) {
      lines.push(`  - ${tp.name || tp.product_name}: ${tp.quantity_sold || tp.count || ""} sold`);
    }
  }
  
  return lines.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { company_id } = await req.json();
    if (!company_id) {
      return respond({ success: false, error: "Missing company_id" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const connection = await loadBmsConnection(supabase, company_id);
    if (!connection) {
      return respond({ success: false, error: "No active BMS connection for this company" }, 400);
    }

    console.log(`[BMS-TRAINING-SYNC] Syncing for company ${company_id}, bridge: ${connection.bridge_url}`);

    // Call 3 BMS actions in parallel
    const [productsRes, stockRes, salesRes] = await Promise.all([
      callBMS(connection, "list_products", { company_id }),
      callBMS(connection, "low_stock_alerts", { company_id }),
      callBMS(connection, "get_sales_summary", { company_id }),
    ]);

    const products = formatProducts(productsRes.data);
    const stockAlerts = formatStockAlerts(stockRes.data);
    const salesSummary = formatSalesSummary(salesRes.data);

    // Build structured KB text
    const sections: string[] = [];

    if (products.text) {
      sections.push(`PRODUCTS & PRICING:\n${products.text}`);
    }

    if (stockAlerts.text) {
      sections.push(`LOW STOCK ALERTS:\n${stockAlerts.text}`);
    }

    if (salesSummary) {
      sections.push(`SALES OVERVIEW:\n${salesSummary}`);
    }

    const syncDate = new Date().toISOString();
    const formattedText = sections.length > 0
      ? `[Last synced from BMS: ${syncDate}]\n\n${sections.join("\n\n")}`
      : "";

    return respond({
      success: true,
      formatted_text: formattedText,
      counts: {
        products: products.count,
        stock_alerts: stockAlerts.count,
        has_sales: !!salesSummary,
      },
      raw_errors: {
        products: productsRes.success ? null : productsRes.error,
        stock_alerts: stockRes.success ? null : stockRes.error,
        sales: salesRes.success ? null : salesRes.error,
      },
    });
  } catch (err) {
    console.error("[BMS-TRAINING-SYNC] Error:", err);
    return respond(
      { success: false, error: err instanceof Error ? err.message : "Internal error" },
      500
    );
  }
});
