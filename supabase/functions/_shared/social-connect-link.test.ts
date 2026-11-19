import { assert, assertEquals } from "jsr:@std/assert@1";
import { signConnectLink, signState, verifyConnectLink, verifyState } from "./social-oauth.ts";
import { linkedInPostUrl, rowStatusForTikTok, tiktokPostUrl } from "./social-publish.ts";

const SECRET = "test-secret-for-links";
const link = { k: "link" as const, n: "11111111-1111-1111-1111-111111111111", c: "22222222-2222-2222-2222-222222222222", p: "linkedin" as const, exp: Date.now() + 30 * 60 * 1000 };

Deno.test("connect link round-trips and is bound to company + platform", async () => {
  const t = await signConnectLink(link, SECRET);
  const back = await verifyConnectLink(t, SECRET);
  assert(back);
  assertEquals(back!.c, link.c);
  assertEquals(back!.p, "linkedin");
});

Deno.test("connect link rejects tampering, wrong secret and expiry", async () => {
  const t = await signConnectLink(link, SECRET);
  const [body, sig] = t.split(".");
  const forged = btoa(JSON.stringify({ ...link, c: "33333333-3333-3333-3333-333333333333" })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assertEquals(await verifyConnectLink(`${forged}.${sig}`, SECRET), null);
  assertEquals(await verifyConnectLink(t, "other-secret"), null);
  assertEquals(await verifyConnectLink(`${body}.${sig}x`, SECRET), null);
  const expired = await signConnectLink({ ...link, exp: Date.now() - 1 }, SECRET);
  assertEquals(await verifyConnectLink(expired, SECRET), null);
});

Deno.test("link tokens and OAuth state tokens are not interchangeable", async () => {
  const t = await signConnectLink(link, SECRET);
  assertEquals(await verifyState(t, SECRET), null);
  const st = await signState({ n: link.n, c: link.c, p: "linkedin", u: "link", exp: link.exp }, SECRET);
  assertEquals(await verifyConnectLink(st, SECRET), null);
});

Deno.test("LinkedIn post URL is the encoded URN", () => {
  assertEquals(linkedInPostUrl("urn:li:share:7300000000000000000"), "https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A7300000000000000000");
});

Deno.test("TikTok status mapping and post URL", () => {
  assertEquals(rowStatusForTikTok("PUBLISH_COMPLETE"), "published");
  assertEquals(rowStatusForTikTok("SEND_TO_USER_INBOX"), "sent_to_inbox");
  assertEquals(rowStatusForTikTok("FAILED"), "failed");
  assertEquals(rowStatusForTikTok("PROCESSING_UPLOAD"), "processing");
  assertEquals(tiktokPostUrl("omanut", "123"), "https://www.tiktok.com/@omanut/video/123");
  assertEquals(tiktokPostUrl(null, null), null);
});
