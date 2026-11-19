// Starts a LinkedIn or TikTok connection for a company: creates a single-use,
// 10-minute handshake row and returns the provider's authorize URL with signed state.
// Input (signed in):   { platform: "linkedin" | "tiktok", company_id }
// Input (connect link): { link_token }  — no session needed; the token was minted by
//   mcp-server get_social_connect_url, is HMAC-signed, expires in 30 minutes, is bound to one
//   company + platform, and its row is consumed when the provider callback succeeds.
import {
  OAUTH_SESSION_TTL_MS, buildLinkedInAuthorizeUrl, buildTikTokAuthorizeUrl, randomCodeVerifier, signState,
  socialConfig, tiktokCodeChallenge, verifyConnectLink,
} from "../_shared/social-oauth.ts";
import { authUserId, canManageSocial, corsHeaders, json, jsonError, serviceClient } from "../_shared/social-oauth-server.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "POST only");
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.link_token === "string") return await startFromLink(body.link_token);

    const userId = await authUserId(req);
    if (!userId) return jsonError(401, "Sign in first.", "unauthorized");

    const platform = body?.platform;
    const companyId = typeof body?.company_id === "string" ? body.company_id : "";
    if (platform !== "linkedin" && platform !== "tiktok") return jsonError(400, "platform must be 'linkedin' or 'tiktok'.", "invalid_field");
    if (!UUID.test(companyId)) return jsonError(400, "company_id must be a UUID.", "invalid_field");

    const supabase = serviceClient();
    if (!(await canManageSocial(supabase, userId, companyId))) {
      return jsonError(403, "Only company owners or managers can connect social accounts.", "forbidden");
    }

    const cfg = socialConfig();
    if (!cfg.stateSecret) return jsonError(500, "Social sign-in is not configured (state secret missing).", "not_configured");
    if (platform === "linkedin" && (!cfg.linkedin.clientId || !cfg.linkedin.clientSecret)) {
      return jsonError(500, "LinkedIn app credentials are not configured.", "not_configured");
    }
    if (platform === "tiktok" && (!cfg.tiktok.clientKey || !cfg.tiktok.clientSecret)) {
      return jsonError(500, "TikTok app credentials are not configured.", "not_configured");
    }

    const redirectUri = platform === "linkedin" ? cfg.linkedin.redirectUri : cfg.tiktok.redirectUri;
    const verifier = platform === "tiktok" ? randomCodeVerifier() : null;
    const expiresAt = Date.now() + OAUTH_SESSION_TTL_MS;
    const { data: session, error } = await supabase
      .from("social_oauth_sessions")
      .insert({ user_id: userId, company_id: companyId, platform, code_verifier: verifier, redirect_uri: redirectUri, expires_at: new Date(expiresAt).toISOString() })
      .select("id")
      .single();
    if (error || !session) return jsonError(500, `Could not start the connection: ${error?.message || "unknown"}`, "internal");

    const state = await signState({ n: session.id, c: companyId, p: platform, u: userId, exp: expiresAt }, cfg.stateSecret);
    const authorizeUrl = platform === "linkedin"
      ? buildLinkedInAuthorizeUrl(cfg.linkedin.clientId, redirectUri, state)
      : buildTikTokAuthorizeUrl(cfg.tiktok.clientKey, redirectUri, state, await tiktokCodeChallenge(verifier!));

    return json(200, { ok: true, platform, authorize_url: authorizeUrl, redirect_uri: redirectUri, expires_at: new Date(expiresAt).toISOString() });
  } catch (e: any) {
    console.error("[social-oauth-start]", e?.message);
    return jsonError(500, e?.message || "Unexpected error", "internal");
  }
});

async function startFromLink(token: string): Promise<Response> {
  const cfg = socialConfig();
  const link = await verifyConnectLink(token.trim(), cfg.stateSecret);
  if (!link) return jsonError(400, "This connection link is invalid or has expired. Ask for a new link.", "invalid_link");
  const platform = link.p;
  if (platform === "linkedin" && (!cfg.linkedin.clientId || !cfg.linkedin.clientSecret)) return jsonError(500, "LinkedIn app credentials are not configured.", "not_configured");
  if (platform === "tiktok" && (!cfg.tiktok.clientKey || !cfg.tiktok.clientSecret)) return jsonError(500, "TikTok app credentials are not configured.", "not_configured");

  const supabase = serviceClient();
  // A fresh PKCE verifier on every tap; re-tapping an unused link restarts the handshake.
  const verifier = platform === "tiktok" ? randomCodeVerifier() : null;
  const { data: row, error } = await supabase
    .from("social_oauth_sessions")
    .update({ code_verifier: verifier })
    .eq("id", link.n)
    .eq("kind", "link")
    .eq("company_id", link.c)
    .eq("platform", platform)
    .is("user_id", null)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id, company_id, redirect_uri, expires_at")
    .maybeSingle();
  if (error || !row) return jsonError(400, "This connection link was already used or has expired. Ask for a new link.", "invalid_link");
  const { data: company } = await supabase.from("companies").select("name").eq("id", row.company_id).maybeSingle();
  if (!company) return jsonError(404, "This business no longer exists.", "not_found");

  const exp = Date.parse(row.expires_at);
  const state = await signState({ n: row.id, c: row.company_id, p: platform, u: "link", exp }, cfg.stateSecret);
  const authorizeUrl = platform === "linkedin"
    ? buildLinkedInAuthorizeUrl(cfg.linkedin.clientId, row.redirect_uri, state)
    : buildTikTokAuthorizeUrl(cfg.tiktok.clientKey, row.redirect_uri, state, await tiktokCodeChallenge(verifier!));
  return json(200, { ok: true, platform, company_name: company.name, authorize_url: authorizeUrl, expires_at: row.expires_at });
}
