// Starts a LinkedIn (profile or Company Page) or TikTok connection for a company: creates
// a single-use, 10-minute handshake row and returns the provider's authorize URL with signed state.
// Input (signed in):   { platform: "linkedin" | "linkedin_pages" | "tiktok", company_id }
// Input (connect link): { link_token }  — no session needed; the token was minted by
//   mcp-server get_social_connect_url, is HMAC-signed, expires in 30 minutes, is bound to one
//   company + platform, and its row is consumed when the provider callback succeeds.
import {
  LINKEDIN_PAGES_SCOPES, LINKEDIN_SCOPES, OAUTH_SESSION_TTL_MS, buildLinkedInAuthorizeUrl,
  buildTikTokAuthorizeUrl, randomCodeVerifier, signState, socialConfig, tiktokCodeChallenge,
  verifyConnectLink, type LinkedInMode, type SocialPlatform,
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

    const rawPlatform = body?.platform;
    const companyId = typeof body?.company_id === "string" ? body.company_id : "";
    if (rawPlatform !== "linkedin" && rawPlatform !== "linkedin_pages" && rawPlatform !== "tiktok") {
      return jsonError(400, "platform must be 'linkedin', 'linkedin_pages', or 'tiktok'.", "invalid_field");
    }
    if (!UUID.test(companyId)) return jsonError(400, "company_id must be a UUID.", "invalid_field");

    const isLinkedInPages = rawPlatform === "linkedin_pages";
    const dbPlatform: SocialPlatform = isLinkedInPages ? "linkedin" : rawPlatform;
    const mode: LinkedInMode | undefined = isLinkedInPages ? "organization" : undefined;

    const supabase = serviceClient();
    if (!(await canManageSocial(supabase, userId, companyId))) {
      return jsonError(403, "Only company owners or managers can connect social accounts.", "forbidden");
    }

    const cfg = socialConfig();
    if (!cfg.stateSecret) return jsonError(500, "Social sign-in is not configured (state secret missing).", "not_configured");
    if (rawPlatform === "linkedin" && (!cfg.linkedin.clientId || !cfg.linkedin.clientSecret)) {
      return jsonError(500, "LinkedIn app credentials are not configured.", "not_configured");
    }
    if (rawPlatform === "linkedin_pages" && (!cfg.linkedinPages.clientId || !cfg.linkedinPages.clientSecret)) {
      return jsonError(500, "LinkedIn Pages app credentials are not configured (set LINKEDIN_PAGES_CLIENT_ID and LINKEDIN_PAGES_CLIENT_SECRET).", "not_configured");
    }
    if (rawPlatform === "tiktok" && (!cfg.tiktok.clientKey || !cfg.tiktok.clientSecret)) {
      return jsonError(500, "TikTok app credentials are not configured.", "not_configured");
    }

    const redirectUri = rawPlatform === "linkedin_pages"
      ? cfg.linkedinPages.redirectUri
      : rawPlatform === "linkedin"
      ? cfg.linkedin.redirectUri
      : cfg.tiktok.redirectUri;
    const verifier = dbPlatform === "tiktok" ? randomCodeVerifier() : null;
    const expiresAt = Date.now() + OAUTH_SESSION_TTL_MS;
    const { data: session, error } = await supabase
      .from("social_oauth_sessions")
      .insert({ user_id: userId, company_id: companyId, platform: dbPlatform, code_verifier: verifier, redirect_uri: redirectUri, expires_at: new Date(expiresAt).toISOString() })
      .select("id")
      .single();
    if (error || !session) return jsonError(500, `Could not start the connection: ${error?.message || "unknown"}`, "internal");

    const state = await signState({ n: session.id, c: companyId, p: dbPlatform, u: userId, exp: expiresAt, ...(mode ? { m: mode } : {}) }, cfg.stateSecret);
    const authorizeUrl = rawPlatform === "linkedin_pages"
      ? buildLinkedInAuthorizeUrl(cfg.linkedinPages.clientId, redirectUri, state, LINKEDIN_PAGES_SCOPES)
      : rawPlatform === "linkedin"
      ? buildLinkedInAuthorizeUrl(cfg.linkedin.clientId, redirectUri, state, LINKEDIN_SCOPES)
      : buildTikTokAuthorizeUrl(cfg.tiktok.clientKey, redirectUri, state, await tiktokCodeChallenge(verifier!));

    return json(200, { ok: true, platform: rawPlatform, authorize_url: authorizeUrl, redirect_uri: redirectUri, expires_at: new Date(expiresAt).toISOString() });
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
  const isLinkedInPages = platform === "linkedin" && link.m === "organization";
  if (platform === "linkedin" && !isLinkedInPages && (!cfg.linkedin.clientId || !cfg.linkedin.clientSecret)) return jsonError(500, "LinkedIn app credentials are not configured.", "not_configured");
  if (isLinkedInPages && (!cfg.linkedinPages.clientId || !cfg.linkedinPages.clientSecret)) return jsonError(500, "LinkedIn Pages app credentials are not configured.", "not_configured");
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
  const state = await signState({ n: row.id, c: row.company_id, p: platform, u: "link", exp, ...(isLinkedInPages ? { m: "organization" as const } : {}) }, cfg.stateSecret);
  const authorizeUrl = isLinkedInPages
    ? buildLinkedInAuthorizeUrl(cfg.linkedinPages.clientId, row.redirect_uri, state, LINKEDIN_PAGES_SCOPES)
    : platform === "linkedin"
    ? buildLinkedInAuthorizeUrl(cfg.linkedin.clientId, row.redirect_uri, state, LINKEDIN_SCOPES)
    : buildTikTokAuthorizeUrl(cfg.tiktok.clientKey, row.redirect_uri, state, await tiktokCodeChallenge(verifier!));
  return json(200, { ok: true, platform: isLinkedInPages ? "linkedin_pages" : platform, company_name: company.name, authorize_url: authorizeUrl, expires_at: row.expires_at });
}
