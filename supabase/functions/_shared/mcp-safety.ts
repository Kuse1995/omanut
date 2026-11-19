// Pure helpers for mcp-server "control" tools (publish gate, delete, connected accounts).
// No I/O — safe to unit test.

/** Error with a machine-readable code; mcp-server's tool wrapper renders it as
 *  { ok:false, tool, error:{ code, message, field? }, next_step }. */
export class McpToolError extends Error {
  readonly isMcpToolError = true;
  constructor(
    public readonly code: string,
    message: string,
    public readonly opts: { field?: string; nextStep?: string; details?: Record<string, unknown> } = {},
  ) {
    super(message);
  }
}

/** Strip anything that looks like a credential from a string derived from an upstream response. */
export function redactSecrets(input: unknown): string {
  let s = typeof input === "string" ? input : (() => { try { return JSON.stringify(input); } catch { return String(input); } })();
  if (!s) return "";
  s = s.replace(/(access_token|refresh_token|code_verifier|appsecret_proof|client_secret|input_token|api_key|apikey|password)(=|%3D)[^&\s"'<>]+/gi, "$1$2[REDACTED]");
  s = s.replace(/("(?:access_token|refresh_token|page_access_token|token|code_verifier|appsecret_proof|client_secret|api_key|password)"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"');
  s = s.replace(/Bearer\s+[A-Za-z0-9._~+\/=-]+/gi, "Bearer [REDACTED]");
  s = s.replace(/\bEA[A-Za-z0-9]{20,}\b/g, "[REDACTED_TOKEN]");
  s = s.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]");
  s = s.replace(/\b(sk|pk|rk)[-_][A-Za-z0-9_-]{16,}\b/g, "[REDACTED_KEY]");
  s = s.replace(/\b(act|rft)\.[A-Za-z0-9!*._-]{20,}/g, "[REDACTED_TOKEN]"); // TikTok
  s = s.replace(/\bAQ[A-Za-z0-9_-]{40,}/g, "[REDACTED_TOKEN]"); // LinkedIn
  return s;
}

/** A Meta object id as returned by publish_*: digits, or PAGEID_POSTID. URLs/permalinks are refused. */
export function isMetaObjectId(raw: string): boolean {
  return /^\d{5,25}(_\d{5,25})?$/.test(raw.trim());
}

/** Any id publish_* returns: a Meta id, a LinkedIn post URN, or a TikTok publish_id. URLs are refused. */
export function isPublishedPostId(raw: string): boolean {
  const s = raw.trim();
  return isMetaObjectId(s) || /^urn:li:(share|ugcPost|post):\d{5,30}$/.test(s) || /^v_[a-z_]+~[A-Za-z0-9._-]{4,200}$/.test(s);
}

/** Which platform a stored meta_post_id belongs to. publish-meta-post stores the
 *  Facebook id when Facebook succeeded, otherwise the Instagram id. */
export function platformOfStoredPost(targetPlatform: string | null, errorMessage: string | null): "facebook" | "instagram" | "linkedin" | "tiktok" {
  const t = (targetPlatform || "facebook").toLowerCase();
  if (t === "linkedin" || t === "tiktok") return t;
  if (t === "instagram") return "instagram";
  if (t === "both" && /(^|;\s*)Facebook:/.test(errorMessage || "")) return "instagram";
  return "facebook";
}

export type ImageCheck = { url: string; ok: boolean; status: number | null; content_type: string | null; reason?: string };

/** Judge a fetched media URL: must answer 200 with an image (or video) content type. */
export function evaluateMediaCheck(url: string, status: number | null, contentType: string | null, kind: "image" | "video" = "image"): ImageCheck {
  const ct = contentType ? contentType.split(";")[0].trim().toLowerCase() : null;
  if (status === null) return { url, ok: false, status, content_type: ct, reason: "URL could not be fetched" };
  if (status !== 200) return { url, ok: false, status, content_type: ct, reason: `URL answered HTTP ${status}, expected 200` };
  if (!ct || !ct.startsWith(`${kind}/`)) return { url, ok: false, status, content_type: ct, reason: `Content type is ${ct || "missing"}, expected ${kind}/*` };
  return { url, ok: true, status, content_type: ct };
}

/** Graph API auth failures (expired/invalid token) vs other errors. */
export function isTokenError(err: { code?: number; type?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === 190 || err.code === 102 || err.type === "OAuthException" && (err.code === 190 || err.code === 463 || err.code === 467);
}

/** brand_colors is stored as [{ name, hex }] (the dashboard's format). Accepts that array,
 *  an array of strings, or a string like "Olive #3A4232, Cream #F2EAD3". Null when no hex code is found. */
export function normalizeBrandColors(input: unknown): { name: string; hex: string }[] | null {
  const parts: unknown[] = Array.isArray(input) ? input : typeof input === "string" ? input.split(/[,;\n]+/) : [];
  const out: { name: string; hex: string }[] = [];
  for (const p of parts) {
    if (p && typeof p === "object") {
      const o = p as Record<string, unknown>;
      const hex = typeof o.hex === "string" ? normHex(o.hex) : null;
      if (!hex) return null;
      out.push({ name: typeof o.name === "string" && o.name.trim() ? o.name.trim() : hex, hex });
      continue;
    }
    if (typeof p !== "string" || !p.trim()) continue;
    const m = p.match(/#?\b([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/);
    if (!m) return null;
    const hex = normHex(m[0])!;
    const name = p.replace(m[0], "").replace(/[:()\-–]+/g, " ").replace(/\s+/g, " ").trim();
    out.push({ name: name || hex, hex });
  }
  return out.length ? out : null;
}

function normHex(raw: string): string | null {
  const h = raw.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(h)) return `#${h.toUpperCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(h)) return `#${h.split("").map((c) => c + c).join("").toUpperCase()}`;
  return null;
}
