# Investigation Findings

## Issue 1 — NPS Facebook comments: AI not replying

**What we see in the data:**
- NPS (`North Park School – Solwezi Campus`, page `135351673857361`) credentials are **healthy** (`last_verified_at = 2026‑04‑26`, token len 204).
- Last AI comment reply went out at **05:04 UTC today** (`How much for grade 1 and 3` → tuition reply). Yesterday there were **9+ AI replies** flowing normally.
- Since 05:04 the meta-webhook has only received **reactions and post‑remove events** (`item:'reaction'`, `verb:'remove'`) for NPS — **zero `item:'comment', verb:'add'` events** in 4+ hours.
- Our handler at `meta-webhook/index.ts:140` filters on exactly `value.item === 'comment' && value.verb === 'add'`, so reactions are correctly ignored. The bug isn't in our code path — **Meta has stopped delivering comment events.**

**Root cause (most likely):** the page subscription on Meta's side has lost the `feed`+comments fields. We've seen this pattern before — when a token is refreshed via OAuth or the page admin re-authorizes, the **subscribed_fields** subscription is silently reset and only `feed` reactions/post lifecycle events keep coming through. Two `verb:'remove'` post events at 09:29 hint that someone touched the page recently.

**Secondary risk:** the page access token may be near expiration even though `health_status='healthy'` (which only checks the user token).

## Issue 2 — ANZ WhatsApp: "failing a lot"

**What's actually happening (recent ANZ chats):**
- Customer `+260967546533` sends "Hello! Can I get more info on this?" once → AI replies **3× identical** "Let me get our owner involved — they'll respond shortly." within 1 second (07:43:48, 07:43:48, 07:43:49) and again at 09:07/09:09. 
- That string is `aiOverrides.fallback_message` — it only fires when **the AI call itself errors / times out**, not from a tool. The triple-fire = Twilio retried our webhook because we didn't ack fast enough (`response_timeout = 60s`, AI hung, then Twilio retried twice).
- For another customer the AI hallucinated a product: `"I can't find a product called 'Navy Blue Elegance Set' in my inventory. Did you mean something else?"` — but in the next chat the same set was listed correctly via `list_products`. So `check_stock` is failing the fuzzy lookup before the documented `list_products` fallback kicks in.
- An image-bearing message (`"What about this one size 40"` + jpeg) immediately got `"Let me connect you with the team…"` — that's the **purchase_handoff ack message** (line 1914), but it fired without a real buying signal (no quantity, no price confirmation). The AI is over-triggering `notify_boss(purchase_handoff)` on any product-photo question.

**Root causes:**
1. **AI provider timeout / no early ack.** When the LLM call exceeds `responseTimeout` we save the fallback message and return TwiML — but Twilio has already retried, so the customer gets the same fallback 3×.
2. **`check_stock` returning empty doesn't fall back to `list_products` for this company** (memory `bms-check-stock-fallback` says it should). Need to verify the fallback path runs for ANZ.
3. **`purchase_handoff` over-triggers on photo + product question** with no real buy signal, ending the conversation prematurely.

---

# Plan

## A. NPS Facebook Comments

1. **Force re-subscribe** the NPS page to the comments webhook. Re-run `subscribe-meta-page` with `subscribed_fields=feed,messages,messaging_postbacks,message_deliveries,messaging_referrals` and verify with `GET /{page_id}/subscribed_apps?fields=subscribed_fields` from `meta-ads-verify`.
2. **Add a self-healing health check** to `meta-ads-verify`: when called, also read `subscribed_apps` and surface missing `feed` field. Show a red banner on the Setup → Meta card when comments aren't subscribed.
3. **Add a manual "Re-subscribe page" button** on the Meta integration card that calls `subscribe-meta-page` for the connected page.
4. **Token age telemetry**: in `meta-ads-verify`, call `GET /debug_token` and surface `expires_at`/`data_access_expires_at` so we don't get caught by silent expiries. Add a 7-day-out warning row in `meta_credentials.health_status`.

## B. ANZ WhatsApp Failures

5. **Twilio early-ack pattern.** Refactor the `whatsapp-messages` Twilio path so the function returns `200 OK` (empty TwiML) within ~2s while the AI work continues in `EdgeRuntime.waitUntil(...)`, and the assistant message is delivered via the existing `send-whatsapp` outbound path (not TwiML reply). This kills the duplicate-fallback storm at the source.
6. **Tighten fallback dedup.** Before persisting the fallback message, check if an identical assistant message already landed in the same conversation in the last 10s. If so, drop it.
7. **`check_stock` → `list_products` retry**, scoped to ANZ's BMS shape: when `check_stock` returns 0 hits, automatically call `list_products({search: <term>})` before the AI sees the empty result, per the `bms-check-stock-fallback` memory rule. Add a log line so we can confirm the fallback ran for ANZ.
8. **Refine `purchase_handoff` triggers** in the system prompt:
   - Require either an explicit quantity, an explicit "I'll take/buy/order" verb, OR a confirmation of a specific item the AI just quoted.
   - A bare product photo + "what about this" should ask 1 clarifying question (size? color? quantity?) before any handoff.
   - Document examples directly in the prompt so the model stops handing off on ambiguous photo questions.
9. **Surface failures in the boss UI.** Add a small "AI fell back N times today" counter on the ANZ chat list when the fallback message has fired ≥2× for a single conversation, so the boss sees the pattern.

## C. Verification

- After A.1, post a test comment from a non-page Facebook account on a recent NPS post and confirm `meta-webhook` logs `Processing FB comment …` within ~30s.
- After B.5, send a WhatsApp message to ANZ and confirm Twilio logs show a single 200 response in <3s and exactly **one** assistant message in `messages`.
- After B.7, trigger `check_stock("navy blue")` for ANZ and confirm logs show the `list_products` fallback running before the AI replies.

# Technical notes

- Files touched: `supabase/functions/meta-ads-verify/index.ts`, `supabase/functions/subscribe-meta-page/index.ts`, `supabase/functions/whatsapp-messages/index.ts`, `supabase/functions/bms-agent/index.ts`, `src/components/setup/SetupMetaCard.tsx` (banner), `src/pages/Conversations.tsx` (counter).
- No DB migration required for A. For B, optionally add `companies.metadata.last_fallback_at` for the counter (no schema change needed — JSON).
- Honors locked memories: `anz-baseline`, `bms-check-stock-fallback`, `handoff-notification-contract`, `pending-promise-watchdog`.

Approve and I'll implement A first (fastest fix, unblocks NPS comments today), then B.
