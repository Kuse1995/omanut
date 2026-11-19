// Completes a TikTok connection. Called by /auth/tiktok/callback with { code, state }
// and the signed-in user's session. Uses the PKCE verifier stored with the handshake.
import { redactSecrets } from "../_shared/mcp-safety.ts";
import { TIKTOK_SCOPES, expiresAtFromSeconds, socialConfig } from "../_shared/social-oauth.ts";
import { authUserId, consumeOAuthSession, corsHeaders, json, jsonError, readCallbackBody, serviceClient } from "../_shared/social-oauth-server.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "POST only");
  try {
    const userId = await authUserId(req);
    if (!userId) return jsonError(401, "Sign in on this site to finish connecting TikTok.", "unauthorized");
    const input = readCallbackBody(await req.json().catch(() => ({})));
    if (!input) return jsonError(400, "Missing code or state.", "invalid_field");

    const supabase = serviceClient();
    const consumed = await consumeOAuthSession(supabase, input.state, "tiktok", userId);
    if (!consumed.session) return jsonError(400, consumed.error!, "invalid_state");
    const { session } = consumed;
    const cfg = socialConfig().tiktok;

    const params: Record<string, string> = {
      client_key: cfg.clientKey, client_secret: cfg.clientSecret, code: input.code,
      grant_type: "authorization_code", redirect_uri: session.redirect_uri,
    };
    if (session.code_verifier) params.code_verifier = session.code_verifier;
    const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(15000),
    });
    const token: any = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !token.access_token) {
      console.error("[tiktok-oauth-callback] token exchange failed", tokenRes.status, redactSecrets(token));
      return jsonError(400, `TikTok refused the sign-in: ${token.error_description || token.error || `HTTP ${tokenRes.status}`}`, "platform_refused");
    }

    const meRes = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(15000),
    });
    const me: any = await meRes.json().catch(() => ({}));
    const user = me?.data?.user;
    const openId = user?.open_id || token.open_id;
    if (!openId) {
      return jsonError(400, `Could not read the TikTok profile: ${me?.error?.message || `HTTP ${meRes.status}`}`, "platform_refused");
    }

    const now = Date.now();
    const scopes = typeof token.scope === "string" ? token.scope.split(/[\s,]+/).filter(Boolean) : TIKTOK_SCOPES;
    const { error } = await supabase.from("social_credentials").upsert({
      company_id: session.company_id,
      platform: "tiktok",
      account_id: openId,
      account_name: user?.display_name || null,
      account_type: "creator",
      access_token: token.access_token,
      refresh_token: token.refresh_token || null,
      token_expires_at: expiresAtFromSeconds(token.expires_in, now),
      refresh_expires_at: expiresAtFromSeconds(token.refresh_expires_in, now),
      scopes,
      environment: cfg.environment,
      metadata: { avatar_url: user?.avatar_url || null, connected_by: userId },
      updated_at: new Date(now).toISOString(),
    }, { onConflict: "company_id,platform,account_id" });
    if (error) return jsonError(500, `Connected, but the connection could not be saved: ${error.message}`, "internal");

    const missing = TIKTOK_SCOPES.filter((s) => !scopes.includes(s));
    return json(200, {
      ok: true, platform: "tiktok", account_name: user?.display_name || null, account_id: openId,
      company_id: session.company_id, environment: cfg.environment,
      ...(missing.length ? { warning: `TikTok did not grant: ${missing.join(", ")}. Posting may fail until these are approved.` } : {}),
    });
  } catch (e: any) {
    console.error("[tiktok-oauth-callback]", redactSecrets(e?.message));
    return jsonError(500, e?.message || "Unexpected error", "internal");
  }
});
