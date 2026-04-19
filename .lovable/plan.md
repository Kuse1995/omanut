

## Why ANZ keeps erroring (and Omanut doesn't)

I pulled the data. Here's the actual diagnosis, not a guess:

**Omanut Tech**: 5 errors / 7d. **No `company_ai_overrides` row at all** — runs entirely on hard-coded defaults (`gemini-3-flash-preview` style, 60s timeout, 3 tool rounds, no checkout tools, mostly just answering questions about itself).

**ANZ**: 11 errors / 7d, all `silent_failure` + `timeout` pairs. Looking at conversation `47112e13`, the customer said "Blue pan 25cm" → AI tried to handoff and timed out → fallback message "Sorry about that! I missed that. Could you say that again?" was sent. Same pattern in 5 of the 5 ANZ conversations.

**Five real differences hurting ANZ:**

1. **Wrong primary model** — ANZ uses `google/gemini-3-pro-preview` (slow, preview-tier, often 5-15s). Omanut uses defaults that route to `glm-4.7` for simple messages. Pro-preview is overkill for "I want a pan" and is the #1 source of timeouts.

2. **`max_tool_rounds = 2`** — ANZ has the lowest possible tool budget. The autonomous checkout chain needs `check_stock → record_sale → generate_payment_link` = 3 rounds. Code already auto-bumps to 3 *if* checkout tools are enabled, but ANZ doesn't have `record_sale` or `generate_payment_link` enabled, so it never bumps. Result: any conversation that needs more than 2 tool calls (e.g. `list_products` then `check_stock` then `bms_check_stock`) silently hits the cap.

3. **Missing checkout tools** — `enabled_tools` for ANZ is `{lookup_product, list_media, bms_list_products, notify_boss, send_media, create_scheduled_post}`. There's no `record_sale`, no `generate_payment_link`, no `check_customer`. So when the customer says "I want to buy a pan", the AI can browse but can't close → escalates to handoff → handoff timed out 3 times → silent failure logged.

4. **Stale catalog in system prompt** — The 3,244-char system instructions hard-code the catalog ("Blue pans 24cm — K450 | 4 in stock"). When stock changes, the prompt lies. The AI is told to use BMS as truth (per `bms-data-priority-messaging` memory), but it's also fed contradicting static data that wastes tokens and confuses tool selection.

5. **Hostile fallback message** — ANZ's `fallback_message` is `"Sorry about that! I missed that. Could you say that again?"`. That's what gets sent every time something goes wrong. Customers see this and rage. Omanut uses the default `"Thank you for your patience..."` which at least sets the right expectation.

## The fix — 5 small changes, ordered by impact

### Fix 1 — Right-size ANZ's model (kills most timeouts)
Update `company_ai_overrides` for ANZ:
- `primary_model = 'google/gemini-2.5-flash'` (3-5x faster, plenty smart for retail)
- `max_tokens = 1024` (currently 2048 — overshoot causes long replies + truncation risk)
- `response_timeout_seconds = 30` (currently 60 — fail fast, retry sooner)

### Fix 2 — Enable the autonomous checkout tool chain
Add to ANZ's `enabled_tools`: `record_sale`, `generate_payment_link`, `check_customer`, `check_stock` (the BMS one, not just `bms_list_products`). This unlocks the autonomous checkout authority memory rule.

### Fix 3 — Bump `max_tool_rounds` to 4
Both as the ANZ override and as the floor in code. The auto-bump-to-3-if-checkout logic in `whatsapp-messages/index.ts` line 4636-4646 should also raise the floor for any `list_products`/`check_stock`-enabled company, not just ones with the full triple.

### Fix 4 — Replace ANZ's fallback message
Change to: `"Give me one moment — I'm checking on that for you. 🙏"` (positive, doesn't admit failure, doesn't ask the customer to repeat).

### Fix 5 — Trim the static catalog from system prompt
Replace the hard-coded "Blue pans 24cm — K450 | 4 in stock" block with a one-liner: `"For current stock and prices, always call check_stock or list_products. Do not quote prices from memory."` Keeps prompt at ~1,500 chars (faster), eliminates contradictions with live BMS data.

### Bonus — Add a self-healing migration for any company missing overrides
Auto-seed `company_ai_overrides` with sensible defaults whenever a company is created without one. Right now Omanut has none and works only because hard-coded defaults exist; new companies inherit whatever someone last clicked in the admin UI.

## Files

- New migration: update `company_ai_overrides` for ANZ (model, tokens, timeout, tools, fallback, instructions)
- `supabase/functions/whatsapp-messages/index.ts` line 4636-4646: raise tool-round floor to 4 when any BMS read tool is enabled
- New migration: trigger to auto-create `company_ai_overrides` row on `companies` insert

## Verification

1. Re-send "I want a pan" to ANZ → AI calls `check_stock`, `record_sale`, `generate_payment_link` in one turn, sends payment link. No timeout.
2. Send a vague message ("hello") → routes to fast model, replies in <3s.
3. Force a real failure (kill BMS) → fallback shows the new wording, not "I missed that".
4. `select count(*) from ai_error_logs where company_id=ANZ and created_at > now()` → flat for 24h after deploy.
5. Confirm Omanut still has no override row and still works (no regression).

Total: 2 migrations + 1 edge function edit. ~15 min of work, fixes the ANZ error rate at the root.

