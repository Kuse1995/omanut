import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildTikTokAuthorizeUrl, escapeLinkedInCommentary, needsRefresh, signState, tiktokCodeChallenge,
  tokenStatusFromExpiry, verifyState,
} from "./social-oauth.ts";

const SECRET = "test-secret-" + "x".repeat(40);

Deno.test("state round-trips and rejects tampering, wrong secret and expiry", async () => {
  const p = { n: crypto.randomUUID(), c: crypto.randomUUID(), p: "linkedin" as const, u: crypto.randomUUID(), exp: Date.now() + 60_000 };
  const s = await signState(p, SECRET);
  assertEquals(await verifyState(s, SECRET), p);
  assertEquals(await verifyState(s, SECRET + "y"), null);
  const [body, sig] = s.split(".");
  assertEquals(await verifyState(`${body}x.${sig}`, SECRET), null);
  const expired = await signState({ ...p, exp: Date.now() - 1 }, SECRET);
  assertEquals(await verifyState(expired, SECRET), null);
  assertEquals(await verifyState("garbage", SECRET), null);
});

Deno.test("TikTok PKCE challenge is hex SHA-256", async () => {
  // RFC 7636 appendix B verifier; its SHA-256 in hex
  const c = await tiktokCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
  assertEquals(c, "13d31e961a1ad8ec2f16b10c4c982e0876a878ad6df144566ee1894acb70f9c3");
  const url = new URL(buildTikTokAuthorizeUrl("ck", "https://x/cb", "st", c));
  assertEquals(url.searchParams.get("code_challenge_method"), "S256");
  assertEquals(url.searchParams.get("scope"), "user.info.basic,video.publish,video.upload");
});

Deno.test("LinkedIn commentary escaping keeps hashtags as hashtags", () => {
  assertEquals(escapeLinkedInCommentary("Loans (fast) @ K500 #ZamCash!"), "Loans \\(fast\\) \\@ K500 {hashtag|\\#|ZamCash}!");
  assertEquals(escapeLinkedInCommentary("a_b*c~d"), "a\\_b\\*c\\~d");
  assertEquals(escapeLinkedInCommentary("plain text"), "plain text");
});

Deno.test("token expiry helpers", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  assertEquals(tokenStatusFromExpiry("2026-11-19T13:00:00Z", now), "valid");
  assertEquals(tokenStatusFromExpiry("2026-11-19T11:00:00Z", now), "expired");
  assertEquals(tokenStatusFromExpiry(null, now), "unknown");
  assert(needsRefresh("2026-11-19T12:04:00Z", now));
  assertEquals(needsRefresh("2026-11-19T12:10:00Z", now), false);
  assert(needsRefresh(null, now));
});
