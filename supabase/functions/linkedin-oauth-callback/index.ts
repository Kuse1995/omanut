// Completes a LinkedIn connection. Called by /auth/linkedin/callback with { code, state }
// and the signed-in user's session. Tokens are stored server-side only.
import { redactSecrets } from "../_shared/mcp-safety.ts";
import { LINKEDIN_SCOPES, expiresAtFromSeconds, socialConfig } from "../_shared/social-oauth.ts";
import { authUserId, consumeOAuthSession, corsHeaders, json, jsonError, readCallbackBody, serviceClient } from "../_shared/social-oauth-server.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "POST only");
  try {
    const userId = await authUserId(req); // null is fine for connect-link handshakes
    const input = readCallbackBody(await req.json().catch(() => ({})));
    if (!input) return jsonError(400, "Missing code or state.", "invalid_field");

    const supabase = serviceClient();
    const consumed = await consumeOAuthSession(supabase, input.state, "linkedin", userId);
    if (!consumed.session) {
      const status = consumed.code === "unauthorized" ? 401 : consumed.code === "forbidden" ? 403 : 400;
      return jsonError(status, consumed.error!, consumed.code);
    }
    const { session } = consumed;
    const cfg = socialConfig().linkedin;

    const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code", code: input.code, redirect_uri: session.redirect_uri,
        client_id: cfg.clientId, client_secret: cfg.clientSecret,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const token: any = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !token.access_token) {
      console.error("[linkedin-oauth-callback] token exchange failed", tokenRes.status, redactSecrets(token));
      return jsonError(400, `LinkedIn refused the sign-in: ${token.error_description || token.error || `HTTP ${tokenRes.status}`}`, "platform_refused");
    }

    const meRes = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(15000),
    });
    const me: any = await meRes.json().catch(() => ({}));
    if (!meRes.ok || !me.sub) {
      return jsonError(400, `Could not read the LinkedIn profile: ${me.message || `HTTP ${meRes.status}`}`, "platform_refused");
    }

    const now = Date.now();
    const accountId = `urn:li:person:${me.sub}`;
    const accountName = me.name || [me.given_name, me.family_name].filter(Boolean).join(" ") || null;
    const scopes = typeof token.scope === "string" ? token.scope.split(/[\s,]+/).filter(Boolean) : LINKEDIN_SCOPES;
    const { error } = await supabase.from("social_credentials").upsert({
      company_id: session.company_id,
      platform: "linkedin",
      account_id: accountId,
      account_name: accountName,
      account_type: "person",
      access_token: token.access_token,
      refresh_token: token.refresh_token || null,
      token_expires_at: expiresAtFromSeconds(token.expires_in, now),
      refresh_expires_at: expiresAtFromSeconds(token.refresh_token_expires_in, now),
      scopes,
      environment: "production",
      metadata: { picture: me.picture || null, connected_by: consumed.connectedBy, via: consumed.session.kind },
      updated_at: new Date(now).toISOString(),
    }, { onConflict: "company_id,platform,account_id" });
    if (error) return jsonError(500, `Connected, but the connection could not be saved: ${error.message}`, "internal");

    return json(200, { ok: true, platform: "linkedin", account_name: accountName, account_id: accountId, company_id: session.company_id });
  } catch (e: any) {
    console.error("[linkedin-oauth-callback]", redactSecrets(e?.message));
    return jsonError(500, e?.message || "Unexpected error", "internal");
  }
});
