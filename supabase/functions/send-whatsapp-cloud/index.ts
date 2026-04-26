// Sends an outbound WhatsApp message through the Meta WhatsApp Cloud API for a specific company.
// Only used when companies.whatsapp_provider = 'meta_cloud' and a row exists in company_whatsapp_cloud.
// Twilio remains the default and is handled by send-whatsapp-message.
//
// Input:  { company_id: string, to: string, body?: string, media_url?: string }
// Output: { success: true, message_id: string } or { error }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GRAPH = "https://graph.facebook.com/v21.0";

function jsonError(status: number, message: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeE164(input: string): string {
  // Strip whatsapp: prefix and any non-digits except leading +
  const cleaned = input.replace(/^whatsapp:/i, "").trim();
  const digits = cleaned.replace(/[^\d+]/g, "");
  if (!digits) return "";
  // Meta wants the number WITHOUT a leading + for the `to` field
  return digits.startsWith("+") ? digits.slice(1) : digits;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === serviceKey;

    let userId: string | null = null;
    if (!isServiceRole) {
      if (!authHeader) return jsonError(401, "Missing Authorization header");
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data, error } = await userClient.auth.getUser();
      if (error || !data?.user) return jsonError(401, "Invalid session");
      userId = data.user.id;
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { company_id, to, body, media_url } = await req.json().catch(() => ({}));
    if (!company_id || !to || (!body && !media_url)) {
      return jsonError(400, "company_id, to, and body or media_url are required");
    }

    // If called by a user JWT, verify membership in the company
    if (!isServiceRole && userId) {
      const { data: membership } = await supabase
        .from("company_users")
        .select("company_id")
        .eq("user_id", userId)
        .eq("company_id", company_id)
        .maybeSingle();
      if (!membership) return jsonError(403, "You do not have access to this company");
    }

    // Load credentials
    const { data: creds, error: credsErr } = await supabase
      .from("company_whatsapp_cloud")
      .select("phone_number_id, access_token, display_phone_number, health_status")
      .eq("company_id", company_id)
      .maybeSingle();

    if (credsErr || !creds) {
      return jsonError(
        404,
        "WhatsApp Cloud is not configured for this company. Use the Twilio sender instead."
      );
    }

    const recipient = normalizeE164(to);
    if (!recipient) return jsonError(400, "Invalid 'to' phone number");

    // Build payload
    let payload: Record<string, unknown>;
    if (media_url) {
      // Detect media type from extension; default to image
      const lower = media_url.toLowerCase();
      let mediaKind: "image" | "video" | "audio" | "document" = "image";
      if (/\.(mp4|mov|3gp)(\?|$)/.test(lower)) mediaKind = "video";
      else if (/\.(mp3|ogg|opus|aac|wav|m4a)(\?|$)/.test(lower)) mediaKind = "audio";
      else if (/\.(pdf|docx?|xlsx?|pptx?|csv|txt)(\?|$)/.test(lower)) mediaKind = "document";

      payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: mediaKind,
        [mediaKind]: {
          link: media_url,
          ...(body ? { caption: body } : {}),
        },
      };
    } else {
      payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "text",
        text: { body, preview_url: false },
      };
    }

    const res = await fetch(`${GRAPH}/${creds.phone_number_id}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok || json?.error) {
      console.error("[send-whatsapp-cloud] Meta error", json);
      // Mark health as unhealthy on auth-related failures
      if (json?.error?.code === 190 || res.status === 401) {
        await supabase
          .from("company_whatsapp_cloud")
          .update({ health_status: "unhealthy" })
          .eq("company_id", company_id);
      }
      return jsonError(res.status || 502, json?.error?.message ?? "WhatsApp Cloud send failed", {
        meta_error: json?.error ?? null,
      });
    }

    // Mark healthy on first successful send
    if (creds.health_status !== "healthy") {
      await supabase
        .from("company_whatsapp_cloud")
        .update({ health_status: "healthy", last_verified_at: new Date().toISOString() })
        .eq("company_id", company_id);
    }

    const messageId = json?.messages?.[0]?.id ?? null;
    return new Response(
      JSON.stringify({ success: true, message_id: messageId, raw: json }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[send-whatsapp-cloud] error", err);
    return jsonError(500, err instanceof Error ? err.message : String(err));
  }
});
