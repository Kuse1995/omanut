// tradelist-followup — the 2-hour TradeList nudge.
// Cron (pg_cron every 15 min) calls this function; it finds WhatsApp
// conversations that went quiet ~2 hours ago (a captured lead who was walked
// to the sign-up page but hasn't confirmed), and sends ONE personal follow-up.
// Guards: once per conversation (marker message), opt-out respected,
// customer confirmations respected, human takeovers skipped.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MARKER = "[OTB-FOLLOWUP]";
const WINDOW_MIN = 120;
const TOLERANCE = 40; // fires when last activity is 100-160 minutes old

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!sid || !token) {
    return new Response(JSON.stringify({ error: "Twilio not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const now = Date.now();
  const minTs = new Date(now - (WINDOW_MIN + TOLERANCE) * 60000).toISOString();
  const maxTs = new Date(now - (WINDOW_MIN - TOLERANCE) * 60000).toISOString();

  const { data: convs, error } = await supabase
    .from("conversations")
    .select("id, company_id, phone, customer_name, last_message_at")
    .eq("platform", "whatsapp")
    .eq("status", "active")
    .eq("human_takeover", false)
    .gte("last_message_at", minTs)
    .lte("last_message_at", maxTs)
    .limit(50);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const sent: any[] = [];
  const skipped: any[] = [];

  for (const conv of convs || []) {
    const { data: msgs } = await supabase
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: true });
    const list = msgs || [];
    if (list.length < 2) { skipped.push({ conv: conv.id, reason: "single message" }); continue; }
    if (list.some((m: any) => m.role === "assistant" && String(m.content || "").includes(MARKER))) { skipped.push({ conv: conv.id, reason: "already followed up" }); continue; }
    const lastCustomer = [...list].reverse().find((m: any) => m.role === "user");
    if (lastCustomer && /\b(stop|unsubscribe|remove me)\b/i.test(String(lastCustomer.content || ""))) { skipped.push({ conv: conv.id, reason: "opted out" }); continue; }
    if (lastCustomer && /\b(done|signed up|registered|already listed)\b/i.test(String(lastCustomer.content || ""))) { skipped.push({ conv: conv.id, reason: "customer confirmed" }); continue; }

    const { data: company } = await supabase
      .from("companies")
      .select("name, whatsapp_number, quick_reference_info")
      .eq("id", conv.company_id)
      .single();
    if (!company?.whatsapp_number) { skipped.push({ conv: conv.id, reason: "no whatsapp sender" }); continue; }
    const urlMatch = String(company.quick_reference_info || "").match(/https?:\/\/[^\s]+/);
    if (!urlMatch) { skipped.push({ conv: conv.id, reason: "no website on file" }); continue; }
    const site = urlMatch[0];

    const followUp = "👋 Hi" + (conv.customer_name ? " " + conv.customer_name : "") + "! Just checking in — did you manage to list your business on " + site + "? It's free and takes two minutes. If anything is unclear, reply here and I'll walk you through it personally.";

    const form = new URLSearchParams();
    form.append("From", "whatsapp:" + String(company.whatsapp_number).replace(/^whatsapp:/, ""));
    form.append("To", conv.phone.startsWith("whatsapp:") ? conv.phone : "whatsapp:" + conv.phone);
    form.append("Body", followUp);
    const res = await fetch("https://api.twilio.com/2010-04-01/Accounts/" + sid + "/Messages.json", {
      method: "POST",
      headers: { Authorization: "Basic " + btoa(sid + ":" + token), "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!res.ok) { skipped.push({ conv: conv.id, reason: "twilio " + res.status }); continue; }
    sent.push({ conv: conv.id, phone: conv.phone });
    await supabase.from("messages").insert({ conversation_id: conv.id, role: "assistant", content: MARKER + " " + followUp });
  }

  return new Response(JSON.stringify({ ok: true, candidates: (convs || []).length, sent: sent.length, sentDetails: sent, skipped }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
