import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * BMS Callback Webhook — receives proactive event notifications from the BMS.
 * Events: low_stock, out_of_stock, new_order, payment_confirmed, order_shipped, daily_summary
 * Auth: Bearer <BMS_API_SECRET> header
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate via BMS_API_SECRET
    const authHeader = req.headers.get("Authorization");
    const BMS_API_SECRET = Deno.env.get("BMS_API_SECRET");

    if (!BMS_API_SECRET || !authHeader || authHeader !== `Bearer ${BMS_API_SECRET}`) {
      console.error("[BMS-CALLBACK] Unauthorized request");
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { event, company_id, data } = await req.json();

    if (!event) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing 'event' field" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[BMS-CALLBACK] Event: ${event}, Company: ${company_id}, Data:`, JSON.stringify(data).slice(0, 500));

    // Look up boss phone for the company
    let bossPhone: string | null = null;
    let companyName: string = "Your business";
    let twilioNumber: string | null = null;

    if (company_id) {
      const { data: company } = await supabase
        .from("companies")
        .select("boss_phone, name, whatsapp_number")
        .eq("id", company_id)
        .single();

      if (company) {
        bossPhone = company.boss_phone;
        companyName = company.name;
        twilioNumber = company.whatsapp_number;
      }
    }

    // Helper to send WhatsApp via Twilio
    async function sendWhatsApp(to: string, message: string): Promise<boolean> {
      const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
      const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");

      if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !twilioNumber) {
        console.error("[BMS-CALLBACK] Missing Twilio credentials or company WhatsApp number");
        return false;
      }

      const fromNumber = twilioNumber.startsWith("whatsapp:")
        ? twilioNumber
        : `whatsapp:${twilioNumber}`;
      const toNumber = to.startsWith("whatsapp:")
        ? to
        : `whatsapp:${to}`;

      try {
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
        const formData = new URLSearchParams();
        formData.append("From", fromNumber);
        formData.append("To", toNumber);
        formData.append("Body", message);

        const res = await fetch(twilioUrl, {
          method: "POST",
          headers: {
            "Authorization": "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formData.toString(),
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error("[BMS-CALLBACK] Twilio error:", res.status, errText);
          return false;
        }

        console.log(`[BMS-CALLBACK] WhatsApp sent to ${to}`);
        return true;
      } catch (err) {
        console.error("[BMS-CALLBACK] Send error:", err);
        return false;
      }
    }

    let message = "";
    let customerMessage = "";
    let customerPhone = "";

    switch (event) {
      case "low_stock": {
        const { product_name, current_stock, reorder_level } = data || {};
        message = `⚠️ LOW STOCK ALERT\n\n📦 ${product_name || "Unknown product"}\n📉 Current: ${current_stock ?? "?"} units\n🔄 Reorder Level: ${reorder_level ?? "?"}\n\nConsider restocking soon!`;
        break;
      }

      case "out_of_stock": {
        const { product_name, sku } = data || {};
        message = `🔴 OUT OF STOCK\n\n📦 ${product_name || "Unknown product"}${sku ? `\n🏷️ SKU: ${sku}` : ""}\n\n⚠️ This product is now unavailable for customers.`;
        break;
      }

      case "new_order": {
        const { order_number, customer_name, total_amount, items_count } = data || {};
        message = `🛒 NEW ORDER!\n\n🔖 ${order_number || "N/A"}\n👤 ${customer_name || "Unknown"}\n💰 Total: K${total_amount || "?"}\n📦 Items: ${items_count || "?"}`;
        break;
      }

      case "payment_confirmed": {
        const { order_number, customer_name, customer_phone: cp, amount } = data || {};
        message = `✅ PAYMENT CONFIRMED\n\n🔖 Order: ${order_number || "N/A"}\n👤 ${customer_name || "Unknown"}\n💰 Amount: K${amount || "?"}`;
        // Also notify the customer
        if (cp) {
          customerPhone = cp;
          customerMessage = `✅ Payment received!\n\nYour payment for order ${order_number || ""} has been confirmed. Your order is now being processed.\n\nThank you for shopping with ${companyName}! 🎉`;
        }
        break;
      }

      case "order_shipped": {
        const { order_number, customer_phone: cp, customer_name } = data || {};
        // Notify boss
        message = `🚚 ORDER SHIPPED\n\n🔖 ${order_number || "N/A"}\n👤 ${customer_name || "Unknown"}`;
        // Notify customer
        if (cp) {
          customerPhone = cp;
          customerMessage = `🚚 Your order ${order_number || ""} has been shipped!\n\nYour order is on its way. Thank you for your patience!\n\n— ${companyName}`;
        }
        break;
      }

      case "order_delivered": {
        const { order_number, customer_phone: cp } = data || {};
        if (cp) {
          customerPhone = cp;
          customerMessage = `📦 Your order ${order_number || ""} has been delivered!\n\nWe hope you enjoy your purchase. How was your experience? 😊\n\n— ${companyName}`;
        }
        break;
      }

      case "daily_summary": {
        const { date, total_sales, total_revenue, top_product } = data || {};
        message = `📊 DAILY SUMMARY — ${date || new Date().toLocaleDateString()}\n\n🛒 Sales: ${total_sales ?? 0}\n💰 Revenue: K${total_revenue ?? 0}${top_product ? `\n🏆 Top Seller: ${top_product}` : ""}\n\nGood job today! 💪`;
        break;
      }

      case "invoice_overdue": {
        const { invoice_number, client_name, amount, days_overdue } = data || {};
        message = `⏰ OVERDUE INVOICE\n\n📄 ${invoice_number || "N/A"}\n👤 ${client_name || "Unknown"}\n💰 K${amount || "?"}\n📅 ${days_overdue || "?"} days overdue`;
        break;
      }

      case "large_sale": {
        const { customer_name, amount, product_name } = data || {};
        message = `🎉 BIG SALE ALERT!\n\n👤 ${customer_name || "Unknown"}\n💰 K${amount || "?"}\n📦 ${product_name || "N/A"}\n\nGreat work! 🚀`;
        break;
      }

      case "new_contact": {
        const { name, email, subject, message: contactMessage } = data || {};
        message = `📩 NEW CONTACT INQUIRY\n\n👤 ${name || "Unknown"}\n📧 ${email || "N/A"}${subject ? `\n📋 Subject: ${subject}` : ""}\n\n💬 ${contactMessage || "No message"}`;
        break;
      }

      default:
        console.log(`[BMS-CALLBACK] Unknown event: ${event}`);
        return new Response(
          JSON.stringify({ success: false, error: `Unknown event: ${event}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    const results: string[] = [];

    // Send boss notification
    if (message && bossPhone) {
      const sent = await sendWhatsApp(bossPhone, message);
      results.push(`boss_notified: ${sent}`);
    }

    // Send customer notification
    if (customerMessage && customerPhone) {
      const sent = await sendWhatsApp(customerPhone, customerMessage);
      results.push(`customer_notified: ${sent}`);
    }

    console.log(`[BMS-CALLBACK] ${event} processed:`, results.join(", "));

    return new Response(
      JSON.stringify({ success: true, event, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[BMS-CALLBACK] Error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
