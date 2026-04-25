## Why ANZ's owner is not getting handoff alerts

I pulled the data for ANZ General Dealers (`74ec87e8-…`). Three real problems are stacking up — only one of them is "the AI didn't trigger". The other two are infrastructure bugs that silently swallow every notification, even when the AI does fire.

### Problem 1 — Owner's phone has a literal SPACE in it (silent killer)

`companies.boss_phone` for ANZ is stored as `+260 967546533`.
The second owner-phone row in `company_boss_phones` is also `+260 967546533`.

Every Twilio send concatenates this as `whatsapp:+260 967546533`. Twilio rejects any "To" with whitespace — the request returns 400 and the boss never gets the message. Twilio errors are caught and logged but the AI is never told the send failed, so it tells the customer "the owner has been notified" while the owner sees nothing.

This alone explains why hot leads like Corinne ("I would like 3 please" — K2,160 sale) and Lucy ("Just this set" — K4,700) never reached her. The DB even shows `error_type='handoff_delivered'` for Corinne's lead at 19:08 — meaning the tool *thought* it succeeded because we never validated the Twilio response status.

### Problem 2 — `sendBossHandoffNotification` only reads `companies.boss_phone`, ignores `company_boss_phones`

You added a multi-recipient table (`company_boss_phones`) with a `notify_alerts` flag per phone. The handoff function never reads it. So even if the social_media_manager (`+260972064502`, also marked `notify_alerts=true`) should also get the buying-signal ping, only the (broken) primary phone is attempted.

### Problem 3 — The AI's `notify_boss` triggers are still too soft for buying signals

I scanned `boss_conversations` and `ai_error_logs` for the last 48h. Pattern:

- The AI fires `notify_boss` reliably for **complaints, frustration, refunds** (good — that path works structurally).
- It does NOT fire for clear *purchase intent* like "I would like 3 please", "just this set", "I need those for chilanga mulilo events". Those trip the supervisor agent (which writes a "🚨 BUYING SIGNAL" entry into `boss_conversations` with `handed_off_by=NULL`) but never call the WhatsApp-sending tool. The supervisor analysis is only a database row — no message goes out.

Net effect: hot leads land in a table nobody is watching while the AI keeps chatting.

---

## The fix — three coordinated changes

### Fix 1 — Normalize all boss phone numbers and validate at write time

1. One-time DB migration: strip spaces and non-`+digit` characters from every `companies.boss_phone` and `company_boss_phones.phone` already in the database. (ANZ's `+260 967546533` becomes `+260967546533`.)
2. Add a Postgres `BEFORE INSERT/UPDATE` trigger on both tables that sanitizes the phone (`regexp_replace(phone, '[^+0-9]', '', 'g')`) and rejects values that don't match `^\+\d{8,15}$`.
3. In the Boss Phones admin UI (`CompanySettingsPanel` / boss-phone editor), trim whitespace on input and show a red error if the value isn't valid E.164.
4. In `sendBossHandoffNotification` and `sendFallbackToCustomer`, sanitize the `boss_phone` again at send time (defensive) and **check the Twilio response status** — if `!response.ok`, throw so the tool returns `success:false` and the AI tells the customer truthfully "I've logged your request, the team will follow up" instead of lying.

### Fix 2 — Make handoffs fan out to every opted-in recipient

Refactor `sendBossHandoffNotification` (in `whatsapp-messages/index.ts`) to:

1. Load all rows from `company_boss_phones` where `company_id = X` AND `notify_alerts = true` (use the existing helper in `_shared/boss-phones.ts`).
2. Fall back to `companies.boss_phone` only if the table is empty.
3. Send to each recipient in parallel; log success/failure per phone in `ai_error_logs` with the phone number in `analysis_details`.
4. The tool returns `success:true` only if **at least one** recipient received the message. If all fail → `success:false, error:'boss_unreachable'`.

This means ANZ's social media manager (Abraham) will also get the buying-signal ping — useful when the owner is offline.

### Fix 3 — Wire the supervisor's buying-signal detection directly into `notify_boss`

The supervisor agent already detects buying intent ("HOT LEAD", "BUYING SIGNAL"). Right now it just writes a row to `boss_conversations`. We will:

1. In the supervisor analysis path of `whatsapp-messages/index.ts` (around line 2003 where it sets `selectedAgent === 'boss'`), when the supervisor flags a buying signal with confidence ≥ 0.7, call `sendBossHandoffNotification` directly with `handedOffBy='supervisor_buying_signal'` and a structured context block (product mentioned, quantity, price, customer phone). No reliance on the model deciding to call a tool.
2. Tighten the `notify_boss` HARD TRIGGERS list in the system prompt (around line 2315) to add **explicit purchase-intent triggers**:
   - "I want N", "I'll take", "give me", "I need it", "just this one/set", "how do I pay", "send the details" — call `notify_boss` with `notification_type='purchase_handoff'` BEFORE replying.
   - Any quantity + product mention in the same turn → mandatory `notify_boss`.
3. Idempotency stays at 30 min, but explicit purchase-intent bypasses dedupe (every buying signal is worth a ping — the owner can mute if needed).

### What changes for ANZ specifically

- Owner's phone gets cleaned to `+260967546533` automatically by the migration.
- Next time a customer says "I'll take 3 of those" she gets a WhatsApp like:
  `🔔 ACTION REQUIRED — Buying signal: Corinne wants 3 whistling kettles @ K720 = K2,160. Reply to take over.`
- Abraham (social media manager) also gets it because his row has `notify_alerts=true`.
- If Twilio ever fails, the AI tells the customer the truth instead of "the owner has been notified".

---

## Files touched

- `supabase/migrations/<new>_normalize_boss_phones.sql` — backfill cleanup + sanitize trigger.
- `supabase/functions/whatsapp-messages/index.ts` — refactor `sendBossHandoffNotification` to fan out via `company_boss_phones`, validate Twilio response, hook supervisor buying-signals into a direct call, expand `notify_boss` prompt triggers.
- `supabase/functions/_shared/boss-phones.ts` — already has the lookup helper; minor extension to filter by notification flag (`notify_alerts`).
- `supabase/functions/send-boss-notification/index.ts` — same Twilio response validation + multi-recipient fan-out (used by social-media flows).
- `src/components/admin/CompanySettingsPanel.tsx` (boss-phone editor) — trim + E.164 validation on save with inline error.
- `mem://features/handoff-notification-contract.md` — update to record the multi-recipient + buying-signal contract.

## Validation

1. Run migration → `SELECT phone FROM company_boss_phones WHERE phone ~ ' '` returns zero rows; `companies.boss_phone` for ANZ shows `+260967546533`.
2. Send a test "I want 2 please" from a sandbox number to ANZ → both the owner and Abraham receive the WhatsApp ping within 5 s; `ai_error_logs` shows `handoff_delivered` with both phones in `analysis_details`.
3. Temporarily blank ANZ's `boss_phone` AND remove notify rows → AI replies with "I've logged your request, the team will follow up", DB has `handoff_failed/boss_unreachable`, no false "owner notified".
4. Try saving `+260 977 abc` in the admin UI → blocked with inline error.
5. 24-hour log tail post-deploy: every "🚨 BUYING SIGNAL" supervisor row is followed by a `[HANDOFF] Boss notification sent` log line. Zero gaps.

No frontend routing changes beyond the boss-phone editor. No RLS changes.