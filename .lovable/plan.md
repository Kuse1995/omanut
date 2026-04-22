

## Fix the real cause: phantom `bms_*` tool names

The watchdog and router are now working. The AI keeps stalling because it calls `bms_list_products` — a tool that's **advertised to the model but not executable**. The executor's `BMS_TOOLS` array contains `list_products` and `check_stock`, not their `bms_*` aliases. Result: tool call goes nowhere, no tool result is returned, synthesis fallback fires "one moment 🙏", watchdog kicks in, same broken loop.

### Evidence

From the latest log:
```
[TOOLS] Enabled tools: ["lookup_product","list_media","send_media","search_media",
                        "notify_boss","check_stock","bms_list_products","bms_check_stock", ...]
[AI-TOOLS] toolNames: ["bms_list_products"]      ← AI picks the phantom name
[BACKGROUND] AI response: assistantReply: ""     ← no real reply
[FALLBACK] No AI response generated, using contextual fallback
[BACKGROUND] Final reply: Give me one moment — I'm checking on that for you. 🙏
```

DB confirms `enabled_tools` still contains the `bms_*` aliases.

### Fixes

#### 1. Normalize tool aliases at runtime (`whatsapp-messages/index.ts`)
When building `enabledToolNames` from company overrides, map every `bms_<name>` → `<name>` and de-duplicate. This makes the system tolerant to whatever's stored in the DB.

```text
bms_list_products  → list_products
bms_check_stock    → check_stock
bms_*              → *
```

Then the AI gets a clean tool list, picks `list_products`, the executor recognizes it, BMS bridge runs, real catalog comes back.

#### 2. Stop hard-coding `glm-4.7` for "simple" messages
Line 2629: `selectedModel = messageComplexity === 'simple' ? 'glm-4.7' : primaryModel`.
This overrides the company's configured model with `glm-4.7` — which works only because Zhipu has credit. But it bypasses the per-company config we just fixed. Change to: always use `primaryModel`. Faster routing should be a model-config concern, not a runtime override.

#### 3. Clean ANZ's `enabled_tools` in the DB (one-time migration)
Remove `bms_list_products`, `bms_check_stock` from ANZ's `company_ai_overrides.enabled_tools`. Keep `list_products`, `check_stock`. Belt-and-suspenders alongside fix #1.

#### 4. Synthesis-fallback safety net
When the AI returns an empty reply AND tool calls were attempted but **no executor matched them** (zero tool results pushed), do NOT emit "Give me one moment 🙏". Instead:
- log `[TOOL-MISMATCH] AI called <name> which has no executor` 
- escalate immediately to `notify_boss(customer_issue)` 
- send the customer the clean handoff message

This breaks the infinite-stall pattern at the source so the watchdog never even has to fire for this class of bug.

#### 5. Re-enable the watchdog cron
Now that the underlying loop is fixed, re-schedule `pending-promise-watchdog` at `*/1 * * * *`. With the cooldown + hard-cap + re-stall detection already in place, it's safe.

#### 6. Unpause ANZ conversation `67b90349-...`
Set `is_paused_for_human = false`, reset `promise_fulfillment_count = 0`, clear `last_promise_fulfillment_at`. Ready for the verification test.

### Validation

Send "what's in stock?" to ANZ:
- `[TOOLS]` log shows `list_products` (not `bms_list_products`).
- AI calls `list_products` → bms-agent runs → real catalog returned.
- Customer gets stock + photos in one turn, no "one moment".
- `messages.message_metadata.promise_fulfillment` is never written.

### Files

- `supabase/functions/whatsapp-messages/index.ts` — alias normalization, drop hard-coded `glm-4.7`, tool-mismatch escalation in synthesis fallback.
- DB migration — clean ANZ `enabled_tools`, unpause conversation, reset counters, re-add cron.

No new tools, no schema changes, no UI changes.

