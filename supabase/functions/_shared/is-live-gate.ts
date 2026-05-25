// Outbound is_live gate. When companies.is_live = false, dispatchers must NOT
// call real providers — instead log the intended payload to test_outbound_log
// so it surfaces in /admin/sandbox-console.
//
// Feature flag: SANDBOX_ENFORCEMENT env var. When set to "off" the gate is
// disabled globally (escape hatch).

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

type Channel =
  | "whatsapp_cloud"
  | "twilio_whatsapp"
  | "meta_dm"
  | "fb_comment_reply"
  | "meta_ads"
  | "scheduled_post";

export interface DispatchContext {
  company_id: string;
  channel: Channel;
  recipient?: string | null;
  payload: Record<string, unknown>;
}

export interface DispatchDecision {
  allowed: boolean;
  reason?: string;
  logged_id?: string;
}

let _client: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  return _client;
}

/**
 * Returns { allowed: true } when the dispatcher may proceed with a real call.
 * When the company is not live, writes to test_outbound_log and returns
 * { allowed: false } so the caller can short-circuit.
 */
export async function checkIsLive(ctx: DispatchContext): Promise<DispatchDecision> {
  // Global kill-switch
  if ((Deno.env.get("SANDBOX_ENFORCEMENT") ?? "on").toLowerCase() === "off") {
    return { allowed: true, reason: "sandbox_enforcement_disabled" };
  }

  const sb = admin();
  const { data, error } = await sb
    .from("companies")
    .select("is_live")
    .eq("id", ctx.company_id)
    .maybeSingle();

  if (error) {
    // Fail open with a warning — observability layer will flag dispatcher errors
    console.warn("[is-live-gate] lookup failed, allowing", error.message);
    return { allowed: true, reason: "lookup_failed" };
  }

  if (data?.is_live === true) {
    return { allowed: true };
  }

  // Sandbox: log and block
  const { data: logged } = await sb
    .from("test_outbound_log")
    .insert({
      company_id: ctx.company_id,
      channel: ctx.channel,
      recipient: ctx.recipient ?? null,
      payload: ctx.payload,
      reason: "company_not_live",
    })
    .select("id")
    .maybeSingle();

  return { allowed: false, reason: "company_not_live", logged_id: logged?.id };
}
