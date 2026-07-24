# Messaging & Handoff Hardening

Three targeted fixes based on the 24h analysis. All changes are backend/edge-function only — no UI work.

## 1. Tighten hot-lead escalation triggers

**Problem**: Taxi-app inquiry and similar high-intent leads didn't ping the boss because supervisor thresholds for `conversion_probability` / `urgency` were too high, and the deterministic escalator in `whatsapp-messages` requires signals that rarely fire together.

**Change** (`supabase/functions/whatsapp-messages/index.ts` + `supabase/functions/supervisor-agent/index.ts`):
- Lower deterministic hot-lead escalator to fire when **any** of:
  - `conversion_probability >= 0.5` (was 0.7)
  - `urgency in ('high','critical')`
  - user message contains buying-intent keywords (`quote`, `price`, `how much`, `book`, `order`, `interested in`, `need a`, `want to buy`) AND conversation has ≥2 user turns
- Supervisor: emit `hot_lead=true` at `conversion_probability >= 0.5`.
- Keep 30-min dedupe via `boss_conversations` `[conv_id]` marker (existing convention).

## 2. Surface real AI failures instead of generic fallback

**Problem**: When the full fallback chain fails, the customer sees "I couldn't complete that just now" and the boss sees nothing actionable — the failure is invisible until you inspect logs.

**Change** (`supabase/functions/whatsapp-messages/index.ts` + `_shared/fallback.ts` if present):
- On terminal AI failure (all models in `geminiChatWithFallback` exhausted), in addition to the customer fallback text:
  - Fire `send-boss-notification` with a compact alert: customer phone, last user message, error class (auth / quota / overload / unknown), conversation link.
  - Dedupe to 1 alert per (company, error_class) per 15 min so a provider outage doesn't spam.
- Log the failure to `ai_error_logs` with `severity='critical'` so `/rule-violations` (or an errors view) can surface it.

## 3. Mute repeat-spam after first decline

**Problem**: Once a customer has been declined / told "not available" / handed off, subsequent identical or near-identical inbound messages still cost a full AI round-trip and can re-trigger fallbacks.

**Change** (`supabase/functions/whatsapp-messages/index.ts`):
- Before running the AI, check the last 5 assistant turns for a "decline marker" (handoff sent, "we don't offer", explicit "no" answer). If found AND the new user message is:
  - identical to a prior user message in this conversation, OR
  - within Levenshtein similarity ≥ 0.9 of a prior declined message
  → skip AI, do NOT reply, log to `ai_error_logs` as `suppressed_repeat` (info), and only ping boss if it's the 3rd repeat.
- Reset suppression when the user sends a materially different message.

## Technical details

- Buying-intent keyword list lives in a small const array at top of `whatsapp-messages/index.ts`.
- Error-class detection: parse error message for `401|invalid`, `402|quota|insufficient`, `429|overload|rate`, else `unknown`.
- Dedupe queries use existing `boss_conversations.message_content ilike '%<marker>%'` pattern already in `meta-lead-alert` and `engagement-watchdog`.
- No schema changes required — `ai_error_logs` already has `severity` and `error_type` columns; `boss_conversations` handles dedupe markers.

## Out of scope

- No UI changes.
- No changes to model selection / fallback chain itself (Kimi K2.6 primary stays).
- No changes to supervisor-agent's core scoring model — only its emission threshold.
