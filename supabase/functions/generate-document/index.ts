import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Colors
const BRAND_BLUE = rgb(0.11, 0.39, 0.67);
const BRAND_DARK = rgb(0.15, 0.15, 0.2);
const BRAND_GRAY = rgb(0.4, 0.4, 0.45);
const BRAND_LIGHT = rgb(0.92, 0.93, 0.95);
const WHITE = rgb(1, 1, 1);
const GREEN = rgb(0.13, 0.59, 0.33);
const RED = rgb(0.8, 0.15, 0.15);

interface DocRequest {
  document_type: "invoice" | "quotation" | "sales_report" | "expense_report" | "profit_loss" | "receivables" | "payables" | "stock_report";
  data: any;
  company_id: string;
  send_whatsapp?: boolean;
}

function drawLine(page: any, x1: number, y: number, x2: number, color = BRAND_LIGHT, thickness = 1) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
}

function wrapText(text: string, maxWidth: number, fontSize: number, font: any): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, fontSize) > maxWidth) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { document_type, data, company_id, send_whatsapp = true }: DocRequest = await req.json();

    // Fetch company info for branding
    const { data: company } = await supabase
      .from("companies")
      .select("name, business_type, hours, boss_phone, currency_prefix, whatsapp_number, twilio_number, payment_number_mtn, payment_number_airtel, payment_instructions")
      .eq("id", company_id)
      .single();

    if (!company) {
      return new Response(JSON.stringify({ success: false, error: "Company not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const currency = company.currency_prefix || "K";
    const pdfDoc = await PDFDocument.create();
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const helveticaOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    let page = pdfDoc.addPage([595, 842]); // A4
    const { width, height } = page.getSize();
    const margin = 50;
    let y = height - margin;

    // ===== HEADER =====
    const drawHeader = (title: string, subtitle?: string) => {
      // Brand bar
      page.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: BRAND_BLUE });
      
      // Company name
      page.drawText(company.name.toUpperCase(), {
        x: margin, y: height - 35, size: 18, font: helveticaBold, color: WHITE,
      });
      
      // Business type
      if (company.business_type) {
        page.drawText(company.business_type, {
          x: margin, y: height - 52, size: 10, font: helvetica, color: rgb(0.85, 0.9, 1),
        });
      }
      
      // Document title on right
      const titleWidth = helveticaBold.widthOfTextAtSize(title, 16);
      page.drawText(title, {
        x: width - margin - titleWidth, y: height - 35, size: 16, font: helveticaBold, color: WHITE,
      });
      
      if (subtitle) {
        const subWidth = helvetica.widthOfTextAtSize(subtitle, 9);
        page.drawText(subtitle, {
          x: width - margin - subWidth, y: height - 52, size: 9, font: helvetica, color: rgb(0.85, 0.9, 1),
        });
      }
      
      y = height - 100;
    };

    // ===== FOOTER =====
    const drawFooter = () => {
      const footerY = 40;
      drawLine(page, margin, footerY + 15, width - margin, BRAND_LIGHT);
      
      const contactParts: string[] = [];
      if (company.boss_phone) contactParts.push(`Tel: ${company.boss_phone}`);
      if (company.whatsapp_number) contactParts.push(`WhatsApp: ${company.whatsapp_number}`);
      
      page.drawText(contactParts.join("  |  ") || company.name, {
        x: margin, y: footerY, size: 7, font: helvetica, color: BRAND_GRAY,
      });
      
      const dateStr = `Generated: ${new Date().toLocaleDateString("en-GB")}`;
      const dateW = helvetica.widthOfTextAtSize(dateStr, 7);
      page.drawText(dateStr, {
        x: width - margin - dateW, y: footerY, size: 7, font: helvetica, color: BRAND_GRAY,
      });

      // Watermark
      page.drawText("Powered by Omanut AI", {
        x: margin, y: footerY - 12, size: 6, font: helveticaOblique, color: rgb(0.7, 0.7, 0.75),
      });
    };

    // Helper: draw a table
    const drawTable = (headers: string[], rows: string[][], colWidths: number[], startY: number): number => {
      const tableX = margin;
      const rowHeight = 22;
      let currentY = startY;

      // Header row
      page.drawRectangle({ x: tableX, y: currentY - rowHeight, width: width - 2 * margin, height: rowHeight, color: BRAND_BLUE });
      let xOffset = tableX + 8;
      headers.forEach((h, i) => {
        page.drawText(h, { x: xOffset, y: currentY - 15, size: 8, font: helveticaBold, color: WHITE });
        xOffset += colWidths[i];
      });
      currentY -= rowHeight;

      // Data rows
      rows.forEach((row, rowIdx) => {
        if (currentY < 80) {
          drawFooter();
          page = pdfDoc.addPage([595, 842]);
          currentY = height - margin;
        }
        
        if (rowIdx % 2 === 0) {
          page.drawRectangle({ x: tableX, y: currentY - rowHeight, width: width - 2 * margin, height: rowHeight, color: rgb(0.96, 0.97, 0.98) });
        }
        
        xOffset = tableX + 8;
        row.forEach((cell, i) => {
          const cellText = String(cell || "").slice(0, 40);
          page.drawText(cellText, { x: xOffset, y: currentY - 15, size: 8, font: helvetica, color: BRAND_DARK });
          xOffset += colWidths[i];
        });
        currentY -= rowHeight;
      });

      return currentY;
    };

    // Helper: labeled value
    const drawLabelValue = (label: string, value: string, x: number, labelY: number) => {
      page.drawText(label, { x, y: labelY, size: 8, font: helvetica, color: BRAND_GRAY });
      page.drawText(value, { x, y: labelY - 13, size: 10, font: helveticaBold, color: BRAND_DARK });
    };

    // ===== DOCUMENT TYPE BUILDERS =====
    const dateNow = new Date().toLocaleDateString("en-GB");

    switch (document_type) {
      case "invoice":
      case "quotation": {
        const isInvoice = document_type === "invoice";
        const title = isInvoice ? "INVOICE" : "QUOTATION";
        const docNum = data.document_number || data.invoice_number || data.quotation_number || `${isInvoice ? "INV" : "QUO"}-${Date.now().toString(36).toUpperCase()}`;
        
        drawHeader(title, `${docNum}`);
        
        // Document info block
        y -= 10;
        drawLabelValue("Document No.", docNum, margin, y);
        drawLabelValue("Date", data.date || dateNow, margin + 150, y);
        drawLabelValue("Valid Until", data.valid_until || "30 days", margin + 300, y);
        y -= 40;
        
        // Client info
        drawLine(page, margin, y, width - margin, BRAND_LIGHT);
        y -= 20;
        page.drawText("BILL TO:", { x: margin, y, size: 9, font: helveticaBold, color: BRAND_BLUE });
        y -= 15;
        page.drawText(data.client_name || "Customer", { x: margin, y, size: 11, font: helveticaBold, color: BRAND_DARK });
        y -= 14;
        if (data.client_email) {
          page.drawText(data.client_email, { x: margin, y, size: 9, font: helvetica, color: BRAND_GRAY });
          y -= 13;
        }
        if (data.client_phone) {
          page.drawText(data.client_phone, { x: margin, y, size: 9, font: helvetica, color: BRAND_GRAY });
          y -= 13;
        }
        y -= 15;
        
        // Items table
        const items = Array.isArray(data.items) ? data.items : [];
        const tableHeaders = ["#", "Description", "Qty", "Unit Price", "Total"];
        const colW = [30, 230, 50, 80, 80];
        
        const tableRows = items.map((item: any, i: number) => {
          const qty = item.quantity || 1;
          const price = item.unit_price || item.price || 0;
          const total = qty * price;
          return [String(i + 1), item.description || item.name || "", String(qty), `${currency}${price.toFixed(2)}`, `${currency}${total.toFixed(2)}`];
        });
        
        y = drawTable(tableHeaders, tableRows, colW, y);
        
        // Totals
        y -= 10;
        const subtotal = items.reduce((s: number, item: any) => s + (item.quantity || 1) * (item.unit_price || item.price || 0), 0);
        const taxRate = data.tax_rate || 0;
        const tax = subtotal * (taxRate / 100);
        const grandTotal = subtotal + tax;
        
        const totalsX = width - margin - 180;
        drawLine(page, totalsX, y, width - margin, BRAND_LIGHT);
        y -= 18;
        page.drawText("Subtotal:", { x: totalsX, y, size: 9, font: helvetica, color: BRAND_GRAY });
        const subStr = `${currency}${subtotal.toFixed(2)}`;
        page.drawText(subStr, { x: width - margin - helveticaBold.widthOfTextAtSize(subStr, 10), y, size: 10, font: helveticaBold, color: BRAND_DARK });
        
        if (taxRate > 0) {
          y -= 18;
          page.drawText(`Tax (${taxRate}%):`, { x: totalsX, y, size: 9, font: helvetica, color: BRAND_GRAY });
          const taxStr = `${currency}${tax.toFixed(2)}`;
          page.drawText(taxStr, { x: width - margin - helveticaBold.widthOfTextAtSize(taxStr, 10), y, size: 10, font: helvetica, color: BRAND_DARK });
        }
        
        y -= 5;
        drawLine(page, totalsX, y, width - margin, BRAND_BLUE, 2);
        y -= 20;
        page.drawText("TOTAL:", { x: totalsX, y, size: 11, font: helveticaBold, color: BRAND_BLUE });
        const totalStr = `${currency}${grandTotal.toFixed(2)}`;
        page.drawText(totalStr, { x: width - margin - helveticaBold.widthOfTextAtSize(totalStr, 14), y, size: 14, font: helveticaBold, color: BRAND_BLUE });
        
        // Payment info
        if (isInvoice && (company.payment_number_mtn || company.payment_instructions)) {
          y -= 40;
          page.drawText("PAYMENT INFORMATION", { x: margin, y, size: 9, font: helveticaBold, color: BRAND_BLUE });
          y -= 15;
          if (company.payment_number_mtn) {
            page.drawText(`MTN Mobile Money: ${company.payment_number_mtn}`, { x: margin, y, size: 9, font: helvetica, color: BRAND_DARK });
            y -= 13;
          }
          if (company.payment_number_airtel) {
            page.drawText(`Airtel Money: ${company.payment_number_airtel}`, { x: margin, y, size: 9, font: helvetica, color: BRAND_DARK });
            y -= 13;
          }
          if (company.payment_instructions) {
            const instrLines = wrapText(company.payment_instructions, width - 2 * margin, 9, helvetica);
            instrLines.forEach(line => {
              page.drawText(line, { x: margin, y, size: 9, font: helvetica, color: BRAND_GRAY });
              y -= 13;
            });
          }
        }
        
        // Notes
        if (data.notes) {
          y -= 20;
          page.drawText("NOTES", { x: margin, y, size: 9, font: helveticaBold, color: BRAND_BLUE });
          y -= 15;
          const noteLines = wrapText(data.notes, width - 2 * margin, 9, helvetica);
          noteLines.forEach(line => {
            page.drawText(line, { x: margin, y, size: 9, font: helveticaOblique, color: BRAND_GRAY });
            y -= 13;
          });
        }
        
        break;
      }

      case "sales_report": {
        const period = data.start_date && data.end_date ? `${data.start_date} — ${data.end_date}` : "All Time";
        drawHeader("SALES REPORT", period);
        
        // Summary cards
        y -= 15;
        const summary = data.summary || data;
        const cardData = [
          { label: "Total Revenue", value: `${currency}${summary.total_revenue || 0}`, color: GREEN },
          { label: "Total Quantity", value: String(summary.total_quantity || 0), color: BRAND_BLUE },
          { label: "Sales Count", value: String(summary.sales_count || 0), color: BRAND_BLUE },
        ];
        
        const cardWidth = (width - 2 * margin - 20) / 3;
        cardData.forEach((card, i) => {
          const cx = margin + i * (cardWidth + 10);
          page.drawRectangle({ x: cx, y: y - 55, width: cardWidth, height: 55, color: rgb(0.96, 0.97, 0.99), borderColor: BRAND_LIGHT, borderWidth: 1 });
          page.drawText(card.label, { x: cx + 10, y: y - 18, size: 8, font: helvetica, color: BRAND_GRAY });
          page.drawText(card.value, { x: cx + 10, y: y - 38, size: 16, font: helveticaBold, color: card.color });
        });
        y -= 75;
        
        // Sales data table
        const sales = Array.isArray(data.data) ? data.data : (Array.isArray(data.sales) ? data.sales : []);
        if (sales.length > 0) {
          const sHeaders = ["Date", "Product", "Qty", "Amount", "Customer", "Payment"];
          const sColW = [70, 140, 40, 70, 100, 70];
          const sRows = sales.slice(0, 30).map((s: any) => [
            s.date || s.created_at?.slice(0, 10) || "",
            (s.product_name || s.name || "").slice(0, 25),
            String(s.quantity || ""),
            s.total ? `${currency}${s.total}` : "",
            (s.customer_name || "").slice(0, 18),
            s.payment_method || "",
          ]);
          y = drawTable(sHeaders, sRows, sColW, y);
        }
        break;
      }

      case "expense_report": {
        const period = data.start_date && data.end_date ? `${data.start_date} — ${data.end_date}` : "All Time";
        drawHeader("EXPENSE REPORT", period);
        
        y -= 15;
        const totalExp = data.total_expenses || 0;
        page.drawText("Total Expenses:", { x: margin, y, size: 10, font: helvetica, color: BRAND_GRAY });
        page.drawText(`${currency}${totalExp}`, { x: margin + 100, y, size: 16, font: helveticaBold, color: RED });
        y -= 30;
        
        const expenses = Array.isArray(data.data) ? data.data : (Array.isArray(data.expenses) ? data.expenses : []);
        if (expenses.length > 0) {
          const eHeaders = ["Date", "Category", "Vendor", "Amount", "Notes"];
          const eColW = [70, 100, 120, 80, 120];
          const eRows = expenses.slice(0, 30).map((e: any) => [
            e.date_incurred || e.date || "",
            e.category || "",
            (e.vendor_name || "").slice(0, 20),
            `${currency}${e.amount_zmw || e.amount || 0}`,
            (e.notes || "").slice(0, 20),
          ]);
          y = drawTable(eHeaders, eRows, eColW, y);
        }
        break;
      }

      case "profit_loss": {
        const period = `${data.start_date || "?"} — ${data.end_date || "?"}`;
        drawHeader("PROFIT & LOSS STATEMENT", period);
        
        y -= 20;
        const revenue = data.total_revenue || 0;
        const expenses = data.total_expenses || 0;
        const netProfit = data.net_profit || (revenue - expenses);
        const margin2 = data.profit_margin || (revenue > 0 ? ((netProfit / revenue) * 100).toFixed(1) : 0);
        const isProfit = netProfit >= 0;
        
        // Revenue block
        page.drawRectangle({ x: margin, y: y - 50, width: width - 2 * margin, height: 50, color: rgb(0.94, 0.98, 0.94), borderColor: GREEN, borderWidth: 1 });
        page.drawText("REVENUE", { x: margin + 15, y: y - 18, size: 9, font: helveticaBold, color: GREEN });
        page.drawText(`${currency}${revenue}`, { x: margin + 15, y: y - 38, size: 20, font: helveticaBold, color: GREEN });
        if (data.sales_count) {
          const scText = `${data.sales_count} sales`;
          page.drawText(scText, { x: width - margin - helvetica.widthOfTextAtSize(scText, 9) - 15, y: y - 35, size: 9, font: helvetica, color: GREEN });
        }
        y -= 60;
        
        // Expenses block
        page.drawRectangle({ x: margin, y: y - 50, width: width - 2 * margin, height: 50, color: rgb(0.98, 0.94, 0.94), borderColor: RED, borderWidth: 1 });
        page.drawText("EXPENSES", { x: margin + 15, y: y - 18, size: 9, font: helveticaBold, color: RED });
        page.drawText(`${currency}${expenses}`, { x: margin + 15, y: y - 38, size: 20, font: helveticaBold, color: RED });
        y -= 60;
        
        // Expense breakdown
        if (data.expense_breakdown && typeof data.expense_breakdown === "object") {
          page.drawText("Expense Breakdown", { x: margin, y, size: 10, font: helveticaBold, color: BRAND_DARK });
          y -= 5;
          const bHeaders = ["Category", "Amount"];
          const bColW = [300, 190];
          const bRows = Object.entries(data.expense_breakdown).map(([cat, amt]) => [cat, `${currency}${amt}`]);
          y = drawTable(bHeaders, bRows, bColW, y);
          y -= 10;
        }
        
        // Net profit block
        const profitColor = isProfit ? GREEN : RED;
        page.drawRectangle({ x: margin, y: y - 60, width: width - 2 * margin, height: 60, color: BRAND_BLUE });
        page.drawText("NET PROFIT", { x: margin + 15, y: y - 20, size: 10, font: helveticaBold, color: WHITE });
        page.drawText(`${currency}${netProfit}`, { x: margin + 15, y: y - 45, size: 24, font: helveticaBold, color: WHITE });
        const marginText = `Margin: ${margin2}%`;
        page.drawText(marginText, { x: width - margin - helveticaBold.widthOfTextAtSize(marginText, 12) - 15, y: y - 42, size: 12, font: helveticaBold, color: WHITE });
        
        break;
      }

      case "receivables":
      case "payables": {
        const isReceivables = document_type === "receivables";
        const title = isReceivables ? "OUTSTANDING RECEIVABLES" : "OUTSTANDING PAYABLES";
        const subtitle = isReceivables ? "Who Owes You" : "What You Owe";
        drawHeader(title, subtitle);
        
        y -= 15;
        const totalKey = isReceivables ? "total_outstanding" : "total_payable";
        const total = data[totalKey] || 0;
        page.drawText(`Total ${isReceivables ? "Receivable" : "Payable"}:`, { x: margin, y, size: 10, font: helvetica, color: BRAND_GRAY });
        page.drawText(`${currency}${total}`, { x: margin + 130, y, size: 18, font: helveticaBold, color: isReceivables ? GREEN : RED });
        y -= 30;
        
        const items = Array.isArray(data.data) ? data.data : (Array.isArray(data.items) ? data.items : []);
        if (items.length > 0) {
          const rHeaders = isReceivables ? ["Customer", "Invoice #", "Amount", "Due Date", "Status"] : ["Vendor", "Bill #", "Amount", "Due Date", "Status"];
          const rColW = [130, 100, 80, 90, 90];
          const rRows = items.slice(0, 30).map((item: any) => [
            (item.customer_name || item.vendor_name || item.name || "").slice(0, 22),
            item.invoice_number || item.bill_number || item.reference || "",
            `${currency}${item.amount || item.total || 0}`,
            item.due_date || "",
            item.status || "pending",
          ]);
          y = drawTable(rHeaders, rRows, rColW, y);
        }
        break;
      }

      case "stock_report": {
        drawHeader("INVENTORY REPORT", dateNow);
        
        y -= 15;
        const items = Array.isArray(data.data) ? data.data : (Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []));
        if (items.length > 0) {
          const sHeaders = ["Product", "SKU", "Stock", "Price", "Status", "Reorder"];
          const sColW = [150, 70, 60, 70, 70, 70];
          const sRows = items.slice(0, 40).map((item: any) => [
            (item.name || item.product_name || "").slice(0, 25),
            item.sku || "",
            String(item.current_stock ?? item.stock ?? ""),
            `${currency}${item.unit_price || item.price || 0}`,
            item.status || "",
            String(item.reorder_level ?? ""),
          ]);
          y = drawTable(sHeaders, sRows, sColW, y);
        }
        break;
      }

      default:
        return new Response(JSON.stringify({ success: false, error: `Unknown document type: ${document_type}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    drawFooter();

    // Generate PDF bytes
    const pdfBytes = await pdfDoc.save();
    const fileName = `${document_type}_${Date.now()}.pdf`;
    const filePath = `${company_id}/${fileName}`;

    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from("company-documents")
      .upload(filePath, pdfBytes, { contentType: "application/pdf", upsert: true });

    if (uploadError) {
      console.error("[GENERATE-DOC] Upload error:", uploadError);
      return new Response(JSON.stringify({ success: false, error: `Upload failed: ${uploadError.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get a signed URL (valid for 7 days)
    const { data: signedUrlData } = await supabase.storage
      .from("company-documents")
      .createSignedUrl(filePath, 7 * 24 * 60 * 60);

    const pdfUrl = signedUrlData?.signedUrl || "";

    console.log(`[GENERATE-DOC] PDF generated: ${fileName}, URL: ${pdfUrl.slice(0, 80)}...`);

    // Send via WhatsApp to boss if requested
    let whatsappSent = false;
    if (send_whatsapp && company.boss_phone && pdfUrl) {
      try {
        const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
        const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
        const fromNumber = company.twilio_number || company.whatsapp_number;

        if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && fromNumber) {
          const bossPhone = company.boss_phone.startsWith("+") ? company.boss_phone : `+${company.boss_phone}`;
          const docLabel = document_type.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());

          const formData = new URLSearchParams();
          formData.append("To", `whatsapp:${bossPhone}`);
          formData.append("From", `whatsapp:${fromNumber}`);
          formData.append("Body", `📄 ${docLabel} — ${company.name}\n\nYour document is ready! Download it here:`);
          formData.append("MediaUrl", pdfUrl);

          const twilioRes = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
            {
              method: "POST",
              headers: {
                Authorization: `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: formData.toString(),
            }
          );

          if (twilioRes.ok) {
            whatsappSent = true;
            console.log("[GENERATE-DOC] PDF sent to boss via WhatsApp");
          } else {
            const errText = await twilioRes.text();
            console.error("[GENERATE-DOC] Twilio send error:", errText);
          }
        }
      } catch (whatsappErr) {
        console.error("[GENERATE-DOC] WhatsApp delivery error:", whatsappErr);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      pdf_url: pdfUrl,
      file_name: fileName,
      whatsapp_sent: whatsappSent,
      message: `📄 ${document_type.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())} PDF generated${whatsappSent ? " and sent to your WhatsApp" : ""}!`,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[GENERATE-DOC] Error:", err);
    return new Response(JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
