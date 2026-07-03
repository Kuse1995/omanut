## Problem

For OmanutBMS, no boss handoff notification has fired in the last week even though 10+ real conversations came in with clear buying signals ("I sell LPG gas, challenge is keeping sales records", "Track stock as well", "How does the Hustler Plan work?", plus a customer providing phone/date for a callback). DB confirms:

- `boss_conversations` has zero `ai_agent_handoff` rows for this company — the AI never called `notify_boss`.
- `supervisor-agent` ran on every message but its stored recommendations never emit `urgency` or `conversionProbability`, so the auto-escalation branch in `supervisor-agent/index.ts` (lines 356–420) never triggers.
- `engagement-watchdog` cron only alerts after **8+** user messages — every recent lead sits at 1–4, so it never fires either.
- Result: all three layers of the "Missed-Lead Escalation Stack" memory are silent for this account.

## Fix (4 layers, deterministic-first)

### 1. Force supervisor to emit urgency + conversion signal
`supabase/functions/supervisor-agent/index.ts`
- Update the supervisor system prompt to REQUIRE the JSON output include `urgency` (`low|medium|high|critical`), `conversionProbability` (0–100), and `buyingSignal` (bool).
- Broaden the auto-escalation heuristic: fire on any of
  - `urgency` = high/critical
  - `conversionProbability` >= 50 (was 70)
  - `buyingSignal` true regardless of prob
  - Business-qualifier keywords in the customer message (industry name, employee count, "I sell", "my business", "we run", "we supply", provided phone/date/time) — treat as qualified lead.
- Keep the 30-min dedupe.

### 2. Deterministic server-side escalator in whatsapp-messages
`supabase/functions/whatsapp-messages/index.ts`
- After the tool loop finishes, if the AI didn't call `notify_boss` in this turn AND the incoming user message matches a strict "hot-lead" regex (demo/call booking, "book a call", "when can we talk", "I want to buy", "I'll take", "how do I pay", "MTN/Airtel MoMo?", or the qualifier phrases above), call `sendBossHandoffNotification` server-side with `notification_type='auto_hot_lead'` and the 30-min dedupe check.
- This guarantees the boss gets pinged even if the model ignores the prompt.

### 3. Lower engagement-watchdog threshold
`supabase/functions/engagement-watchdog/index.ts`
- `MIN_USER_MESSAGES`: 8 → 4.
- `ACTIVE_WINDOW_HOURS`: 2 → 6 (catch leads that went cold within the same session).

### 4. Tighten notify_boss prompt triggers
`supabase/functions/whatsapp-messages/index.ts` (system-prompt block around lines 2436–2461)
- Add explicit trigger: "When a customer shares business context (industry, size, pain point, phone/email, or requests a call/demo) they are a QUALIFIED LEAD — call `notify_boss` with `notification_type='qualified_lead'` on that same turn."
- Add explicit trigger: "When the customer books/asks for a call, demo, or meeting, call `notify_boss` with `notification_type='demo_booking'` and include the requested time and their contact."
- Reinforce that failing to escalate a qualified lead is a critical failure.

### Verification

After deploy, watch for:
- New `ai_agent_handoff` rows in `boss_conversations` for OmanutBMS as new conversations arrive.
- Supervisor recommendations JSON now containing `urgency` / `conversionProbability` / `buyingSignal`.
- WhatsApp delivery to +260972064502 (boss phone, `notify_alerts=true`).

No schema changes; no frontend changes.
