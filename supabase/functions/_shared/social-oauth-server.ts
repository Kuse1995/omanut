// Request plumbing shared by social-oauth-start and the LinkedIn/TikTok callbacks.
import { createClient } from "npm:@supabase/supabase-js@2";
import { redactSecrets } from "./mcp-safety.ts";
import { socialConfig, verifyState, type SocialPlatform } from "./social-oauth.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
export function jsonError(status: number, message: string, code = "error") {
  return json(status, { ok: false, error: { code, message: redactSecrets(message) } });
}

export function serviceClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

/** Validates the caller's session JWT. Returns the user id or null. */
export async function authUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data } = await client.auth.getUser();
  return data?.user?.id ?? null;
}

/** Company owners/managers and platform admins may connect social accounts. */
export async function canManageSocial(supabase: any, userId: string, companyId: string): Promise<boolean> {
  const { data: m } = await supabase.from("company_users").select("role").eq("user_id", userId).eq("company_id", companyId).maybeSingle();
  if (m && (m.role === "owner" || m.role === "manager")) return true;
  const { data: admin } = await supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  return Boolean(admin);
}

/** Verifies the signed state, then atomically consumes the matching single-use session row.
 *  Signed-in handshakes must be finished by the same user. Connect-link handshakes (state
 *  u === "link", minted by mcp-server's get_social_connect_url) need no session: the
 *  signed, expiring, single-use link bound to one company is the authorisation. */
export async function consumeOAuthSession(supabase: any, state: string, platform: SocialPlatform, userId: string | null) {
  const payload = await verifyState(state, socialConfig().stateSecret);
  if (!payload) return { error: "This connection link is invalid or has expired. Start again from Setup.", code: "invalid_state" };
  if (payload.p !== platform) return { error: "This link was started for a different platform.", code: "invalid_state" };
  const isLink = payload.u === "link";
  if (!isLink) {
    if (!userId) return { error: "Sign in on this site to finish connecting.", code: "unauthorized" };
    if (payload.u !== userId) return { error: "This connection was started by a different user. Sign in as that user, or start again.", code: "invalid_state" };
  }
  let q = supabase
    .from("social_oauth_sessions")
    .update({ used_at: new Date().toISOString() })
    .eq("id", payload.n)
    .eq("platform", platform)
    .eq("company_id", payload.c)
    .eq("kind", isLink ? "link" : "session")
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString());
  q = isLink ? q.is("user_id", null) : q.eq("user_id", userId);
  const { data: session, error } = await q.select("id, company_id, code_verifier, redirect_uri, kind").maybeSingle();
  if (error || !session) return { error: "This connection link was already used or has expired. Ask for a new link, or start again from Setup.", code: "invalid_state" };
  if (!isLink && !(await canManageSocial(supabase, userId!, session.company_id))) {
    return { error: "You no longer have permission to manage this company.", code: "forbidden" };
  }
  return { session, connectedBy: isLink ? "connect_link" : userId!, mode: payload.m || "person" };
}

export function readCallbackBody(raw: any): { code: string; state: string } | null {
  const code = typeof raw?.code === "string" ? raw.code.trim() : "";
  const state = typeof raw?.state === "string" ? raw.state.trim() : "";
  if (!code || code.length > 2048 || !state || state.length > 2048) return null;
  return { code, state };
}
