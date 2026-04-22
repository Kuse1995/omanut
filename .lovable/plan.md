

## Root-cause fix: stop the AI from promising tools it doesn't have

### What's actually broken (three layers, all need fixing)

**Layer 1 — Prompt advertises tools the company doesn't have.**
The reservation/date workflow at `whatsapp-messages/index.ts` lines ~2442-2522 is injected into **every** company's system prompt. It explicitly tells the AI to "IMMEDIATELY call `get_date_info`" and "call `check_calendar_availability`". GreenGrid (and most non-restaurant companies) doesn't have any of these tools enabled — so the model dutifully *promises* to "check the date" and then has nothing to call. Result: the "Let me check the date for you first" stall the customer just saw.

**Layer 2 — Seed defaults are far too thin.**
`seed_company_ai_overrides()` gives every new company only `{search_media, send_media, notify_boss, create_scheduled_post, check_customer}`. No `get_date_info`. No reservation tools. No knowledge search. No conversation search. Companies like GreenGrid (solar installer — books site visits!) are structurally unable to handle the most common request type.

**Layer 3 — Watchdog only catches one phrase shape.**
`pending-promise-watchdog` regex matches "give me a moment", "checking on that", "let me check" — but **not** "let me check the date for you first", "I'd be happy to help… Let me…", "I'll find that out…", etc. The 23:23 stall went undetected and unrecovered.

And the meta-bug: there's no contract between the prompt-builder and the tool-filter, so prompts can reference tools that have been filtered out.

### Fix — eliminate the contract gap, not just patch this case

**1. Make the prompt tool-aware (not company-type-aware).**
Refactor the system-prompt assembly in `whatsapp-messages/index.ts` so that **every block that mentions a tool is gated on that tool actually being in `enabledToolNames`**. Specifically:
- Reservation workflow block (lines ~2453-2522) → only injected if `enabledToolNames` includes `create_reservation`.
- Date-validation block referencing `get_date_info` (lines ~2442-2448) → only injected if `enabledToolNames` includes `get_date_info`.
- Calendar check step → only if `check_availability` enabled.
- Autonomous checkout block (line ~2523) → only if `record_sale` + `generate_payment_link` enabled.
- Digital product delivery block → only if `deliver_digital_product` enabled.
- Media instructions (search_media/send_media) → already gated implicitly; confirm and tighten.

Add a single helper `hasTool(name: string): boolean` used by every conditional block, and a final assertion log: `[PROMPT-CHECK] mentions=[…] enabled=[…] missing=[…]` — if `missing` is non-empty, log `[PROMPT-CHECK] DRIFT` so we catch this class of bug immediately in future.

**2. Add a "no promises without tools" rule to every prompt.**
Inject a short universal block at the top of every system prompt:

> **CAPABILITY DISCIPLINE**: You may ONLY promise actions you can perform with the tools listed below. NEVER say "let me check…", "give me a moment…", "I'll find out…", or any variant unless you are calling a tool **in the same response**. If you don't have a tool for what the customer asked, give a direct answer based on the knowledge you have, OR call `notify_boss` to escalate. Do NOT stall.

**3. Expand the seed defaults to a sane baseline.**
Update `seed_company_ai_overrides()` trigger to seed:
```
['search_media','send_media','search_knowledge','search_past_conversations',
 'notify_boss','check_customer','create_scheduled_post','get_date_info',
 'check_availability','create_reservation']
```
`get_date_info` + `check_availability` + `create_reservation` are non-destructive (they read or stage records, no money) and cover the "can I book X on Friday" pattern across solar, water, beauty, services. BMS tools and payment tools stay opt-in.

**4. Backfill existing companies.**
One-shot migration: for each company in `company_ai_overrides`, union the new baseline into `enabled_tools`. Don't strip anything they already have — just add the missing core tools. Affects GreenGrid, Finch, ANZ, Omanut, Art of Intelligence, North Park, E-Library.

**5. Broaden the watchdog promise detector.**
Add patterns to `PROMISE_PATTERNS` in `pending-promise-watchdog/index.ts`:
```
/let me check (the |that |on )?(date|availability|calendar|schedule|stock|with)/i
/i'?ll (find out|check|look (in)?to|get (back )?to you|reach out)/i
/i'?d be happy to .* let me/i  
/let me (find|look|pull|grab)/i
/checking (now|that for you|right now)/i
/give me (a sec|a second|a minute|a min)/i
/hold on/i
```
Also: detect the watchdog's own re-stall by checking `message_metadata.promise_fulfillment === true` (already wired) and escalate after **1** retry.

**6. Tighten the fallback-message field default.**
Replace seed `fallback_message` from `"Give me one moment — I'm checking on that for you. 🙏"` (which IS the stall pattern) with `"Let me get our owner involved — they'll respond shortly."` so timeouts don't masquerade as a promise the AI never intends to fulfill.

### Files

- **`supabase/functions/whatsapp-messages/index.ts`**
  - Add `hasTool(name)` helper after `enabledToolNames` is finalized (around line 3245).
  - Move the tool-filtering block (currently 3178-3245) **before** the system-prompt assembly, so the prompt can gate on it. Right now filtering happens after most prompt strings are built — that's the structural bug.
  - Gate reservation/date/calendar/checkout/digital-delivery prompt blocks on `hasTool(...)`.
  - Add the universal "CAPABILITY DISCIPLINE" block to the prompt.
  - Add `[PROMPT-CHECK]` drift log at the end of prompt assembly.
- **`supabase/functions/pending-promise-watchdog/index.ts`** — expand `PROMISE_PATTERNS`; tighten escalation when `wasFulfillmentOutput` is true (already in code, just covered by broader regex now).
- **DB migration**
  - Replace `seed_company_ai_overrides()` body with the expanded tool list and improved `fallback_message`.
  - Backfill: `UPDATE company_ai_overrides SET enabled_tools = ARRAY(SELECT DISTINCT unnest(enabled_tools || ARRAY['search_knowledge','search_past_conversations','get_date_info','check_availability','create_reservation']))`.
  - Backfill: `UPDATE company_ai_overrides SET fallback_message = 'Let me get our owner involved — they''ll respond shortly.' WHERE fallback_message ILIKE '%one moment%';`
- **`mem://configurations/anz-baseline.md`** + **`mem://architecture/company-ai-overrides-defaults.md`** — document the new baseline + the prompt-tool contract rule.

### Validation

1. **Repro the GreenGrid case**: customer asks "Can I have battery back up done on Friday?" → AI calls `get_date_info` → calls `check_availability` → asks for missing details (name/email) in **one** reply, no stall.
2. **No-tool path**: temporarily strip `get_date_info` from a test company → AI does NOT promise to check; either answers directly or calls `notify_boss`. Verify `[PROMPT-CHECK] DRIFT` log is **silent** (because the prompt no longer mentions `get_date_info`).
3. **Watchdog coverage**: insert a synthetic assistant message "Let me check the date for you first." → next watchdog tick detects it, re-runs once, escalates if still stalled.
4. **No regressions**: Finch reservation flow, ANZ media flow, ANZ checkout flow all still work end-to-end.
5. **Inspect logs**: tail `whatsapp-messages` → `[TOOLS] Enabled tools` line shows the expanded baseline for GreenGrid; `[PROMPT-CHECK]` line shows zero drift.

No frontend changes. No RLS changes. No BMS code changes.

