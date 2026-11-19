import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateMediaCheck, isMetaObjectId, isPublishedPostId, isTokenError, normalizeBrandColors, platformOfStoredPost, redactSecrets } from "./mcp-safety.ts";

Deno.test("redactSecrets strips tokens from Graph-style errors and URLs", () => {
  const tok = "EAAB" + "x".repeat(60);
  const s = redactSecrets(`GET https://graph.facebook.com/v21.0/123/posts?fields=id&access_token=${tok}&limit=5 failed; Authorization: Bearer ${tok}; {"access_token":"${tok}"}`);
  assert(!s.includes(tok), s);
  assert(s.includes("access_token=[REDACTED]"));
  assert(s.includes("Bearer [REDACTED]"));
  assertEquals(redactSecrets("Error validating access token: Session has expired"), "Error validating access token: Session has expired");
});

Deno.test("isMetaObjectId accepts publish ids and refuses URLs", () => {
  assert(isMetaObjectId("645175628672290_122112233445566"));
  assert(isMetaObjectId("17912345678901234"));
  assert(!isMetaObjectId("https://www.facebook.com/645175628672290/posts/122112233445566"));
  assert(!isMetaObjectId("pfbid02abc"));
  assert(!isMetaObjectId(""));
});

Deno.test("platformOfStoredPost", () => {
  assertEquals(platformOfStoredPost("instagram", null), "instagram");
  assertEquals(platformOfStoredPost("facebook", null), "facebook");
  assertEquals(platformOfStoredPost("both", null), "facebook");
  assertEquals(platformOfStoredPost("both", "Facebook: (#200) permissions"), "instagram");
  assertEquals(platformOfStoredPost("both", "Instagram publish: failed"), "facebook");
});

Deno.test("evaluateMediaCheck needs 200 + image type", () => {
  assert(evaluateMediaCheck("u", 200, "image/png; charset=binary").ok);
  assertEquals(evaluateMediaCheck("u", 404, "text/html").ok, false);
  assertEquals(evaluateMediaCheck("u", 200, "text/html").ok, false);
  assertEquals(evaluateMediaCheck("u", null, null).ok, false);
  assert(evaluateMediaCheck("u", 200, "video/mp4", "video").ok);
});

Deno.test("isTokenError", () => {
  assert(isTokenError({ code: 190, type: "OAuthException" }));
  assertEquals(isTokenError({ code: 100, type: "GraphMethodException" }), false);
  assertEquals(isTokenError(null), false);
});

Deno.test("normalizeBrandColors", () => {
  assertEquals(normalizeBrandColors("Olive #3A4232, Cream #f2ead3"), [{ name: "Olive", hex: "#3A4232" }, { name: "Cream", hex: "#F2EAD3" }]);
  assertEquals(normalizeBrandColors([{ name: "Gold", hex: "fc0" }]), [{ name: "Gold", hex: "#FFCC00" }]);
  assertEquals(normalizeBrandColors(["#000000"]), [{ name: "#000000", hex: "#000000" }]);
  assertEquals(normalizeBrandColors("warm earthy tones"), null);
  assertEquals(normalizeBrandColors([{ name: "x", hex: "nope" }]), null);
});

Deno.test("redactSecrets strips TikTok/LinkedIn tokens and refresh tokens", () => {
  const tt = "act." + "a".repeat(40); const rt = "rft." + "b".repeat(40); const li = "AQ" + "c".repeat(60);
  const s = redactSecrets(`refresh_token=${rt}&x=1 {"refresh_token":"${rt}"} token ${tt} li ${li} code_verifier=abc123`);
  for (const v of [tt, rt, li, "abc123"]) assert(!s.includes(v), s);
});

Deno.test("isPublishedPostId covers all platforms and refuses URLs", () => {
  assert(isPublishedPostId("645175628672290_122112233445566"));
  assert(isPublishedPostId("urn:li:share:7123456789012345678"));
  assert(isPublishedPostId("urn:li:ugcPost:7123456789012345678"));
  assert(isPublishedPostId("v_pub_file~v2-1.7245638612355678210"));
  assert(!isPublishedPostId("https://www.linkedin.com/feed/update/urn:li:share:7123456789012345678"));
  assert(!isPublishedPostId("urn:li:person:abc"));
  assertEquals(platformOfStoredPost("linkedin", null), "linkedin");
  assertEquals(platformOfStoredPost("tiktok", null), "tiktok");
});
