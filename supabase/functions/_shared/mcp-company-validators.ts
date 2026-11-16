// Pure validation helpers for the mcp-server company/media/product tools.
// No I/O — safe to unit test.

/** Normalise a Zambian mobile number to +260XXXXXXXXX. Returns null if invalid. */
export function normalizeZambianPhone(raw: string): string | null {
  const s = raw.replace(/^whatsapp:/i, "").replace(/[\s\-().]/g, "");
  let digits: string;
  if (/^\+260\d{9}$/.test(s)) digits = s.slice(4);
  else if (/^00260\d{9}$/.test(s)) digits = s.slice(5);
  else if (/^260\d{9}$/.test(s)) digits = s.slice(3);
  else if (/^0[79]\d{8}$/.test(s)) digits = s.slice(1);
  else if (/^[79]\d{8}$/.test(s)) digits = s;
  else return null;
  if (!/^[79]/.test(digits)) return null;
  return `+260${digits}`;
}

/** Zambian first, otherwise any valid international E.164 (owners abroad). */
export function normalizeOwnerPhone(raw: string): string | null {
  const zm = normalizeZambianPhone(raw);
  if (zm) return zm;
  const s = raw.replace(/^whatsapp:/i, "").replace(/[\s\-().]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

export const UPDATE_COMPANY_FIELDS = [
  "name", "business_type", "voice_style", "hours", "services", "branches",
  "service_locations", "quick_reference_info", "currency_prefix", "boss_phone",
  "takeover_number", "payment_number_mtn", "payment_number_airtel",
  "payment_number_zamtel", "payment_instructions", "test_mode",
  "payments_disabled", "agent_routing_enabled", "booking_buffer_minutes",
  "image_gen_unlocked",
] as const;

export const ZAMBIAN_PHONE_FIELDS = ["payment_number_mtn", "payment_number_airtel", "payment_number_zamtel"] as const;
export const OWNER_PHONE_FIELDS = ["boss_phone", "takeover_number"] as const;

/** Keys never writable through MCP, with a reason for the error message. */
export function forbiddenCompanyKeyReason(key: string): string | null {
  const hard = ["id", "credit_balance", "subscription_tier", "is_live", "openclaw_webhook_url",
    "openclaw_webhook_token", "openclaw_mode", "openclaw_owns", "admin_last_active", "agent_last_heartbeat"];
  if (hard.includes(key) || key.startsWith("openclaw_")) return "protected field (billing, go-live or agent webhook)";
  if (key.endsWith("_flow_id")) return "protected field (WhatsApp flow id)";
  if (key.startsWith("meta_")) return "protected field (Meta connection id)";
  return null;
}

/** Sanitise an uploaded file name: strip paths, control chars and odd characters. */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() || "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\.\.+/g, ".")
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(0, 200);
  return cleaned || "file";
}

export const MEDIA_MIME: Record<string, { ext: string; media_type: string }> = {
  "image/png": { ext: "png", media_type: "image" },
  "image/jpeg": { ext: "jpg", media_type: "image" },
  "image/webp": { ext: "webp", media_type: "image" },
  "image/svg+xml": { ext: "svg", media_type: "image" },
  "application/pdf": { ext: "pdf", media_type: "document" },
  "video/mp4": { ext: "mp4", media_type: "video" },
};
export const MAX_MEDIA_BYTES = 15 * 1024 * 1024;

/** Check the file's first bytes really match the declared MIME type. */
export function sniffMatches(mime: string, b: Uint8Array): boolean {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  const ascii = (i: number, s: string) => at(i, ...[...s].map((c) => c.charCodeAt(0)));
  switch (mime) {
    case "image/png": return at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/jpeg": return at(0, 0xff, 0xd8, 0xff);
    case "image/webp": return ascii(0, "RIFF") && ascii(8, "WEBP");
    case "application/pdf": return ascii(0, "%PDF-");
    case "video/mp4": return ascii(4, "ftyp");
    case "image/svg+xml": {
      const head = new TextDecoder().decode(b.slice(0, 4096)).toLowerCase();
      return head.includes("<svg");
    }
    default: return false;
  }
}

/** SVGs are served from a public bucket — refuse anything scriptable. */
export function svgIsUnsafe(b: Uint8Array): boolean {
  const t = new TextDecoder().decode(b).toLowerCase();
  return /<script|javascript:|\son[a-z]+\s*=|<foreignobject|<iframe|<embed|<object/.test(t);
}

/** Cheap width/height for PNG / JPEG / WebP. */
export function imageDimensions(mime: string, b: Uint8Array): { width: number; height: number } | null {
  try {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (mime === "image/png" && b.length >= 24) return { width: dv.getUint32(16), height: dv.getUint32(20) };
    if (mime === "image/jpeg") {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        const len = dv.getUint16(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
        }
        i += 2 + len;
      }
      return null;
    }
    if (mime === "image/webp" && b.length >= 30) {
      const fmt = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (fmt === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      if (fmt === "VP8 ") return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
      if (fmt === "VP8L") {
        const bits = dv.getUint32(21, true);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    }
  } catch { /* ignore */ }
  return null;
}

/** Map the brief's category names onto the media_category enum. */
export function toMediaCategory(c: string): string {
  return c === "logos" ? "logo" : c;
}

/** Product currency: ISO code. Company prefix 'K' means Zambian kwacha. */
export function productCurrencyFromPrefix(prefix: string | null | undefined): string {
  const p = (prefix || "").trim().toUpperCase();
  if (!p || p === "K" || p === "ZK" || p === "ZMW") return "ZMW";
  return /^[A-Z]{3}$/.test(p) ? p : "ZMW";
}
