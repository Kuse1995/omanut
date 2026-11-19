// LinkedIn + TikTok OAuth helpers shared by social-oauth-start, the two callback
// functions and mcp-server. No top-level I/O; env is read inside functions.

export type SocialPlatform = "linkedin" | "tiktok";

export const LINKEDIN_SCOPES = ["openid", "profile", "email", "w_member_social"];
export const TIKTOK_SCOPES = ["user.info.basic", "video.publish", "video.upload"];
export const OAUTH_SESSION_TTL_MS = 10 * 60 * 1000;
export const CONNECT_LINK_TTL_MS = 30 * 60 * 1000;
/** Public origin connect links point at (the owner taps this from WhatsApp). */
export function connectLinkOrigin(): string {
  return (Deno.env.get("SOCIAL_CONNECT_ORIGIN") || "https://omanut.lovable.app").replace(/\/+$/, "");
}
export const TIKTOK_REFRESH_SKEW_MS = 5 * 60 * 1000;

export function socialConfig() {
  const env = (k: string) => Deno.env.get(k) || "";
  return {
    linkedin: {
      clientId: env("LINKEDIN_CLIENT_ID"),
      clientSecret: env("LINKEDIN_CLIENT_SECRET"),
      redirectUri: env("LINKEDIN_REDIRECT_URI") || "https://omanut.lovable.app/auth/linkedin/callback",
      apiVersion: env("LINKEDIN_API_VERSION") || "202610",
    },
    tiktok: {
      clientKey: env("TIKTOK_CLIENT_KEY"),
      clientSecret: env("TIKTOK_CLIENT_SECRET"),
      redirectUri: env("TIKTOK_REDIRECT_URI") || "https://omanut.lovable.app/auth/tiktok/callback",
      environment: (env("TIKTOK_ENV") || "sandbox") === "production" ? "production" as const : "sandbox" as const,
    },
    stateSecret: env("SOCIAL_OAUTH_STATE_SECRET"),
  };
}

// ── signed state ──
const enc = new TextEncoder();
function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
}

/** u is the signed-in user id, or "link" when the handshake came from an MCP connect link. */
export type OAuthStatePayload = { n: string; c: string; p: SocialPlatform; u: string; exp: number };
/** Connect link token: n = social_oauth_sessions row (kind='link'), c = company, p = platform. */
export type ConnectLinkPayload = { k: "link"; n: string; c: string; p: SocialPlatform; exp: number };
const LINK_DOMAIN = "connect-link:"; // keeps link tokens and OAuth state tokens non-interchangeable

export async function signState(payload: OAuthStatePayload, secret: string): Promise<string> {
  if (!secret) throw new Error("SOCIAL_OAUTH_STATE_SECRET is not configured");
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, body)}`;
}

/** Returns the payload when the signature matches and it has not expired, else null. */
export async function verifyState(state: string, secret: string, now = Date.now()): Promise<OAuthStatePayload | null> {
  if (!secret || typeof state !== "string") return null;
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = await hmac(secret, body);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    if (!p || typeof p.n !== "string" || typeof p.c !== "string" || typeof p.u !== "string") return null;
    if (p.p !== "linkedin" && p.p !== "tiktok") return null;
    if (typeof p.exp !== "number" || p.exp < now) return null;
    return p as OAuthStatePayload;
  } catch {
    return null;
  }
}

export async function signConnectLink(payload: ConnectLinkPayload, secret: string): Promise<string> {
  if (!secret) throw new Error("SOCIAL_OAUTH_STATE_SECRET is not configured");
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, LINK_DOMAIN + body)}`;
}

/** Returns the link payload when the signature matches and it has not expired, else null. */
export async function verifyConnectLink(token: string, secret: string, now = Date.now()): Promise<ConnectLinkPayload | null> {
  if (!secret || typeof token !== "string" || token.length > 2048) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = await hmac(secret, LINK_DOMAIN + body);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    if (!p || p.k !== "link" || typeof p.n !== "string" || typeof p.c !== "string") return null;
    if (p.p !== "linkedin" && p.p !== "tiktok") return null;
    if (typeof p.exp !== "number" || p.exp < now) return null;
    return p as ConnectLinkPayload;
  } catch {
    return null;
  }
}

// ── PKCE (TikTok expects the S256 challenge hex-encoded, not base64url) ──
export function randomCodeVerifier(length = 64): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}
export async function tiktokCodeChallenge(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildLinkedInAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const u = new URL("https://www.linkedin.com/oauth/v2/authorization");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("scope", LINKEDIN_SCOPES.join(" "));
  return u.toString();
}
export function buildTikTokAuthorizeUrl(clientKey: string, redirectUri: string, state: string, codeChallenge: string): string {
  const u = new URL("https://www.tiktok.com/v2/auth/authorize/");
  u.searchParams.set("client_key", clientKey);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", TIKTOK_SCOPES.join(","));
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

// ── token lifetime ──
export function tokenStatusFromExpiry(expiresAt: string | null | undefined, now = Date.now()): "valid" | "expired" | "unknown" {
  if (!expiresAt) return "unknown";
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return "unknown";
  return t > now ? "valid" : "expired";
}
export function needsRefresh(expiresAt: string | null | undefined, now = Date.now(), skewMs = TIKTOK_REFRESH_SKEW_MS): boolean {
  if (!expiresAt) return true;
  const t = Date.parse(expiresAt);
  return Number.isNaN(t) || t - now <= skewMs;
}
export function expiresAtFromSeconds(seconds: unknown, now = Date.now()): string | null {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? new Date(now + n * 1000).toISOString() : null;
}

/** LinkedIn `commentary` uses Little Text Format: reserved characters must be
 *  backslash-escaped or the post is rejected/truncated. `#word` becomes a real hashtag. */
export function escapeLinkedInCommentary(text: string): string {
  const out: string[] = [];
  const re = /#([\p{L}\p{N}_]+)/gu;
  let last = 0;
  const esc = (s: string) => s.replace(/[\\|{}@\[\]()<>#*_~]/g, (m) => `\\${m}`);
  for (const m of text.matchAll(re)) {
    out.push(esc(text.slice(last, m.index)));
    out.push(`{hashtag|\\#|${m[1]}}`);
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(esc(text.slice(last)));
  return out.join("");
}

// ── TikTok refresh (I/O) ──
type TikTokCred = { id: string; access_token: string; refresh_token: string | null; token_expires_at: string | null; refresh_expires_at: string | null; [k: string]: unknown };

/** Refreshes the TikTok access token when it expires within 5 minutes. Persists the new tokens.
 *  Returns { cred, refreshed, error } — never throws with token material in the message. */
export async function ensureFreshTikTokToken(supabase: any, cred: TikTokCred): Promise<{ cred: TikTokCred; refreshed: boolean; error: string | null }> {
  if (!needsRefresh(cred.token_expires_at)) return { cred, refreshed: false, error: null };
  if (!cred.refresh_token) return { cred, refreshed: false, error: "TikTok token expired and no refresh token is stored; reconnect TikTok." };
  if (cred.refresh_expires_at && Date.parse(cred.refresh_expires_at) <= Date.now()) {
    return { cred, refreshed: false, error: "TikTok refresh token has expired; reconnect TikTok." };
  }
  const cfg = socialConfig().tiktok;
  if (!cfg.clientKey || !cfg.clientSecret) return { cred, refreshed: false, error: "TikTok app credentials are not configured." };
  try {
    const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: new URLSearchParams({ client_key: cfg.clientKey, client_secret: cfg.clientSecret, grant_type: "refresh_token", refresh_token: cred.refresh_token }),
      signal: AbortSignal.timeout(15000),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) {
      return { cred, refreshed: false, error: `TikTok refused the token refresh: ${j.error_description || j.error || `HTTP ${res.status}`}` };
    }
    const now = Date.now();
    const next: TikTokCred = {
      ...cred,
      access_token: j.access_token,
      refresh_token: j.refresh_token || cred.refresh_token,
      token_expires_at: expiresAtFromSeconds(j.expires_in, now),
      refresh_expires_at: expiresAtFromSeconds(j.refresh_expires_in, now) || cred.refresh_expires_at,
    };
    const { error } = await supabase.from("social_credentials").update({
      access_token: next.access_token,
      refresh_token: next.refresh_token,
      token_expires_at: next.token_expires_at,
      refresh_expires_at: next.refresh_expires_at,
      updated_at: new Date().toISOString(),
    }).eq("id", cred.id);
    if (error) return { cred: next, refreshed: true, error: `Token refreshed but could not be saved: ${error.message}` };
    return { cred: next, refreshed: true, error: null };
  } catch (e: any) {
    return { cred, refreshed: false, error: `TikTok token refresh failed: ${e?.message || "network error"}` };
  }
}
