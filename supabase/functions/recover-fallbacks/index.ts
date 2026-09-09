// One-off recovery: re-answer customers whose last assistant message was a
// generic "AI failed" fallback. Picks the oldest stuck conversations first and
// re-runs the normal WhatsApp brain with the customer's last question.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const FALLBACK_PATTERNS = [
  "owner involved",
  "couldn't complete that just now",
  "I'm experiencing a brief delay",
];

function normalizeWhatsApp(phone: string): string {
  if (!phone) return "";
  return phone.startsWith("whatsapp:") ? phone : `whatsapp:${phone.startsWith("+") ? phone : `+${phone.replace(/^\+/, "")}`}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const companyId: string | undefined = body.company_id;
  const limit: number = Math.min(Number(body.limit) || 3, 5);
  const dryRun: boolean = body.dry_run === true;
  const hours: number = Number(body.hours) || 24;

  if (!companyId) {
    return new Response(JSON.stringify({ error: "company_id is required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: company } = await supabase
    .from("companies")
    .select("id, whatsapp_number")
    .eq("id", companyId)
    .single();
  if (!company?.whatsapp_number) {
    return new Response(JSON.stringify({ error: "company has no whatsapp_number" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { data: convs } = await supabase
    .from("conversations")
    .select("id, phone, customer_name, last_message_at, is_paused_for_human")
    .eq("company_id", companyId)
    .gte("last_message_at", since)
    .order("last_message_at", { ascending: true })
    .limit(200);

  const results: any[] = [];
  for (const conv of convs || []) {
    if (results.filter((r) => r.action === "recovered").length >= limit) break;
    if (conv.is_paused_for_human) continue;

    const { data: msgs } = await supabase
      .from("messages")
      .select("id, role, content, created_at, message_metadata")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: false })
      .limit(6);
    if (!msgs || msgs.length === 0) continue;

    const last = msgs[0];
    if (last.role !== "assistant") continue;
    const content = String(last.content || "");
    if (!FALLBACK_PATTERNS.some((p) => content.toLowerCase().includes(p.toLowerCase()))) continue;
    const meta = (last.message_metadata && typeof last.message_metadata === "object")
      ? last.message_metadata as Record<string, any> : {};
    if (meta.fallback_recovery === true) continue;

    const userMsg = msgs.find((m) => m.role === "user" && new Date(m.created_at) < new Date(last.created_at));
    if (!userMsg?.content?.trim()) continue;

    if (dryRun) {
      results.push({ conversation_id: conv.id, action: "would_recover", question: userMsg.content.slice(0, 120) });
      continue;
    }

    // Mark first so a re-run never double-sends to the same customer.
    await supabase.from("messages")
      .update({ message_metadata: { ...meta, fallback_recovery: true } })
      .eq("id", last.id);

    try {
      const resp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          isPromiseFulfillment: true,
          From: normalizeWhatsApp(conv.phone || ""),
          To: normalizeWhatsApp(company.whatsapp_number),
          Body: userMsg.content,
          ProfileName: conv.customer_name || "",
        }),
      });
      results.push({ conversation_id: conv.id, action: resp.ok ? "recovered" : "failed", status: resp.status });
    } catch (e) {
      results.push({ conversation_id: conv.id, action: "failed", error: String(e).slice(0, 160) });
    }
  }

  return new Response(JSON.stringify({ ok: true, count: results.length, results }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
