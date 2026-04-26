# Fix ANZ Missed Leads — 4-Part Escalation Overhaul

The audit showed only ~29% of engaged ANZ leads ever reached the owner. Hot leads with explicit purchase intent, delivery addresses, callback requests, and trust complaints were silently dropped. This plan closes those gaps across the full notification pipeline.

---

## 1. Tighten `notify_boss` triggers in the WhatsApp prompt

**File:** `supabase/functions/whatsapp-messages/index.ts` (escalation rules block around line 2416)

Add these missed-lead triggers to the existing HARD TRIGGERS list:

- **Address / location shared** ("deliver to…", "I'm in Kabulonga", any street address) → notify_boss with `notification_type="delivery_request"`
- **Payment method or delivery cost asked** ("how do I pay", "do you deliver to X", "what's shipping to…") → notify_boss
- **Scheduled callback** ("call me at…", "I'll be free tomorrow", "ping me later") → notify_boss with the requested time
- **Price negotiation** ("can you do K…", "what's your best price", "any discount") → notify_boss
- **Trust / credibility complaint** ("are you real", "is this legit", "I don't trust", "scam?") → notify_boss with `notification_type="trust_concern"`
- **Long unresolved engagement** — covered by watchdog (#3) but also instruct AI to escalate at turn 8+ if no purchase has happened

Also strengthen the "when in doubt, escalate" rule: any 4+ user messages without a clear resolution path → notify_boss.

---

## 2. Wire the supervisor agent to auto-trigger boss alerts

**File:** `supabase/functions/supervisor-agent/index.ts`

Currently the supervisor analyzes sentiment, distrust, and buying signals but never tells the boss. Add a post-analysis step:

- After parsing the recommendation, check if it flags any of: `urgency: high`, distrust signals, churn risk, or `conversionProbability >= 70`
- If yes, invoke `send-boss-notification` directly with a digest:
  - Customer name + phone
  - The supervisor's `analysis` and `strategy`
  - Conversation link/ID
- Dedupe via `boss_conversations` lookup (same 30-min pattern used in `meta-lead-alert`) so the supervisor doesn't double-fire alongside `notify_boss`

This catches leads where the primary AI failed to call `notify_boss` but the supervisor saw the signal.

---

## 3. Add an "engagement watchdog" cron

**New file:** `supabase/functions/engagement-watchdog/index.ts` + cron entry in `supabase/config.toml`

Runs every 15 min. SQL: find conversations where:
- `last_message_at` within last 2 hours AND
- 8+ user messages total AND
- No `boss_conversations` row referencing this conversation in the last 24 h AND
- No completed sale (no `bms_write_log` with `intent=record_sale` for this conversation)

For each match, send a single boss alert: *"Long unresolved lead: {customer} has sent {N} messages over {duration}. Last message: '{snippet}'. No escalation yet — please review."*

Insert a marker row in `boss_conversations` to prevent duplicates.

---

## 4. One-time backfill digest of this week's missed ANZ leads

**One-off script (run via exec, not committed):**

Query the conversations I identified in the audit (ANZ company, last 7 days, 4+ user messages, no boss_conversations entry). Send the boss a single WhatsApp summary message via `send-boss-notification` with:

- Total missed leads count
- Top 10 by engagement, each with: customer phone, last message snippet, message count, and a link/ID to open in the inbox

This clears the backlog so the owner can act on what was missed before the new triggers take effect.

---

## Technical details

- **Dedupe pattern**: reuse the 30-min `boss_conversations` `ilike '%conversation_id%'` lookup already used in `meta-lead-alert/index.ts` — keeps everything consistent.
- **Notification channel**: all alerts go through `send-boss-notification` (existing function) → respects `company_boss_phones` roles + per-company `whatsapp_provider` (Twilio vs Meta Cloud).
- **No DB schema changes** required. Watchdog uses existing `conversations.last_message_at`, `messages`, `boss_conversations`, `bms_write_log`.
- **Cron**: add `[functions.engagement-watchdog]` block in `supabase/config.toml` with a `cron = "*/15 * * * *"` schedule (matching `bms-auto-sync-cron` pattern).
- **Scope**: changes apply company-wide (not just ANZ) since the same gaps affect every tenant. ANZ benefits immediately because of its high volume.

---

## Out of scope

- Restructuring the supervisor's analysis depth/model (separate concern)
- Inbox UI changes to surface "missed lead" badges (can be a follow-up)
- Touching the Meta lead alert pipeline (already working via `meta-lead-alert`)
