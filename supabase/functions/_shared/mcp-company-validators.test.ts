import { assertEquals } from "jsr:@std/assert@1";
import {
  normalizeZambianPhone, normalizeOwnerPhone, forbiddenCompanyKeyReason, UPDATE_COMPANY_FIELDS,
  sanitizeFilename, sniffMatches, svgIsUnsafe, toMediaCategory, productCurrencyFromPrefix, MEDIA_MIME,
} from "./mcp-company-validators.ts";
import { DASHBOARD_COMPANY_DEFAULTS } from "./company-defaults.ts";

Deno.test("local 09/07 numbers normalise to +260", () => {
  assertEquals(normalizeZambianPhone("0977000000"), "+260977000000");
  assertEquals(normalizeZambianPhone("0761 234 567"), "+260761234567");
  assertEquals(normalizeZambianPhone("+260977000000"), "+260977000000");
  assertEquals(normalizeZambianPhone("260977000000"), "+260977000000");
});
Deno.test("garbage and non-Zambian numbers are rejected for payment fields", () => {
  assertEquals(normalizeZambianPhone("12345"), null);
  assertEquals(normalizeZambianPhone("+27821234567"), null);
  assertEquals(normalizeZambianPhone("0577000000"), null);
});
Deno.test("owner phone accepts international E.164 as fallback", () => {
  assertEquals(normalizeOwnerPhone("+27821234567"), "+27821234567");
  assertEquals(normalizeOwnerPhone("abc"), null);
});
Deno.test("protected company fields are never in the update allowlist", () => {
  for (const k of ["credit_balance", "is_live", "subscription_tier", "openclaw_webhook_url", "openclaw_mode", "whatsapp_payment_flow_id", "meta_phone_number_id", "id"]) {
    assertEquals(forbiddenCompanyKeyReason(k) !== null, true, k);
    assertEquals((UPDATE_COMPANY_FIELDS as readonly string[]).includes(k), false, k);
  }
});
Deno.test("new companies start in test mode", () => {
  assertEquals(DASHBOARD_COMPANY_DEFAULTS.test_mode, true);
});
Deno.test("filenames cannot escape their folder", () => {
  assertEquals(sanitizeFilename("../../etc/passwd"), "passwd");
  assertEquals(sanitizeFilename("..\\evil\u0000.png"), "evil.png");
});
Deno.test("only allowlisted mime types; executables rejected", () => {
  assertEquals("application/x-msdownload" in MEDIA_MIME, false);
  const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0, 0, 0, 0, 0]);
  assertEquals(sniffMatches("image/png", exe), false);
  assertEquals(sniffMatches("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true);
});
Deno.test("scriptable SVG rejected", () => {
  assertEquals(svgIsUnsafe(new TextEncoder().encode('<svg onload="x()"></svg>')), true);
  assertEquals(svgIsUnsafe(new TextEncoder().encode('<svg><rect/></svg>')), false);
});
Deno.test("logos category maps to logo; K maps to ZMW", () => {
  assertEquals(toMediaCategory("logos"), "logo");
  assertEquals(productCurrencyFromPrefix("K"), "ZMW");
  assertEquals(productCurrencyFromPrefix("USD"), "USD");
});
