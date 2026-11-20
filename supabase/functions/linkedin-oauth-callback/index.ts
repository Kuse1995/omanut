// Completes a LinkedIn connection (personal profile OR Company Page via Community Management API).
// Called by /auth/linkedin/callback and /auth/linkedin-pages/callback with { code, state }.
// Tokens are stored server-side only.
import { redactSecrets } from "../_shared/mcp-safety.ts";
import { LINKEDIN_PAGES_SCOPES, LINKEDIN_SCOPES, expiresAtFromSeconds, socialConfig } from "../_shared/social-oauth.ts";
import { authUserId, consumeOAuthSession, corsHeaders, json, jsonError, readCallbackBody, serviceClient } from "../_shared/social-oauth-server.ts";
import { linkedInFetch, linkedInReason } from "../_shared/social-publish.ts";

const ORG_URN_RE = /^urn:li:organization:(\d+)$/;

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
    const isOrgMode = consumed.mode === "organization" || /linkedin-pages/i.test(session.redirect_uri || "");
    const allCfg = socialConfig();
    const cfg = isOrgMode ? allCfg.linkedinPages : allCfg.linkedin;
    if (!cfg.clientId || !cfg.clientSecret) {
      return jsonError(500, isOrgMode ? "LinkedIn Pages app credentials are not configured." : "LinkedIn app credentials are not configured.", "not_configured");
    }

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

    const now = Date.now();
    const tokenExpiresAt = expiresAtFromSeconds(token.expires_in, now);
    const refreshExpiresAt = expiresAtFromSeconds(token.refresh_token_expires_in, now);

    if (isOrgMode) {
      const scopes = typeof token.scope === "string" ? token.scope.split(/[\s,]+/).filter(Boolean) : LINKEDIN_PAGES_SCOPES;
      // Discover approved LinkedIn Company Pages where this user can administer/post.
      const acls = await linkedInFetch("GET", "/rest/organizationAcls?q=roleAssignee&state=APPROVED&count=50", token.access_token);
      if (!acls.ok) {
        return jsonError(400, `Could not read your LinkedIn Company Pages: ${linkedInReason(acls)}`, "platform_refused");
      }
      const elements: any[] = Array.isArray(acls.body?.elements) ? acls.body.elements : [];
      const allowedRoles = new Set(["ADMINISTRATOR", "CONTENT_ADMIN", "DIRECT_SPONSORED_CONTENT_POSTER"]);
      const orgUrns = [...new Set(
        elements
          .filter((e) => !e?.role || allowedRoles.has(String(e.role).toUpperCase()))
          .map((e) => String(e?.organization || e?.organizationTarget || ""))
          .filter((u) => ORG_URN_RE.test(u)),
      )];
      if (orgUrns.length === 0) {
        return jsonError(400, "No LinkedIn Company Pages found where you are an Administrator or Content Admin.", "not_found");
      }

      const savedPages: Array<{ account_id: string; account_name: string }> = [];
      for (const orgUrn of orgUrns) {
        const orgId = orgUrn.match(ORG_URN_RE)![1];
        let orgName = `LinkedIn Page ${orgId}`;
        let vanityName: string | null = null;
        const orgRes = await linkedInFetch("GET", `/rest/organizations/${orgId}`, token.access_token);
        if (orgRes.ok && orgRes.body) {
          orgName = orgRes.body.localizedName || orgRes.body.vanityName || orgName;
          vanityName = orgRes.body.vanityName || null;
        }
        const { error } = await supabase.from("social_credentials").upsert({
          company_id: session.company_id,
          platform: "linkedin",
          account_id: orgUrn,
          account_name: orgName,
          account_type: "organization",
          access_token: token.access_token,
          refresh_token: token.refresh_token || null,
          token_expires_at: tokenExpiresAt,
          refresh_expires_at: refreshExpiresAt,
          scopes,
          environment: "production",
          metadata: { app: "linkedin_pages", organization_id: orgId, vanity_name: vanityName, connected_by: consumed.connectedBy, via: consumed.session.kind },
          updated_at: new Date(now).toISOString(),
        }, { onConflict: "company_id,platform,account_id" });
        if (error) return jsonError(500, `Connected, but the Company Page could not be saved: ${error.message}`, "internal");
        savedPages.push({ account_id: orgUrn, account_name: orgName });
      }

      return json(200, {
        ok: true,
        platform: "linkedin_pages",
        account_name: savedPages.map((p) => p.account_name).join(", "),
        account_id: savedPages[0].account_id,
        pages: savedPages,
        company_id: session.company_id,
      });
    }

    const meRes = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(15000),
    });
    const me: any = await meRes.json().catch(() => ({}));
    if (!meRes.ok || !me.sub) {
      return jsonError(400, `Could not read the LinkedIn profile: ${me.message || `HTTP ${meRes.status}`}`, "platform_refused");
    }

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
      token_expires_at: tokenExpiresAt,
      refresh_expires_at: refreshExpiresAt,
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
