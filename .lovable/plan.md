

## Stop the message flood and fix the root causes

### Immediate bleeding (do first)

1. **Kill the watchdog cron** temporarily by unscheduling `pending-promise-watchdog` until the underlying loop is fixed. Re-enable in step 4.
2. **Pause ANZ conversation 67b90349-55e9-42c6-9f41-00d8fa601afa** (`is_paused_for_human = true`) so no further auto-replies fire while we fix things.

### Root-cause fixes

#### 3. Fix `routeToAgent` crash (`whatsapp-messages/index.ts` line 719)
Replace unsafe `data.choices[0]` with `data?.choices?.[0]`. If missing, log the payload and fall back to keyword routing. This stops the per-turn `TypeError`.

#### 4. Fix the watchdog infinite loop (`pending-promise-watchdog/index.ts`)
Three guards, all required:
- **Conversation-level cooldown**: track `last_promise_fulfillment_at` on the conversation row (or in a dedicated table). Skip any conversation fulfilled in the last 10 minutes, regardless of which message is now "newest".
- **Per-conversation hard cap**: max 2 fulfillment attempts per rolling hour. Third stall → `notify_boss` + send the customer "owner has been notified" + mark conversation `is_paused_for_human = true` to fully stop the loop.
- **Detect re-stall**: if the message produced by the previous fulfillment is itself a promise pattern, do NOT fulfill it again — escalate immediately.

#### 5. Fix the model config so the AI actually answers
`zai/glm-4.7` does not exist on Google's API. Two options, pick one in the fix:
- **A (recommended)**: normalize `zai/*` → route to Zhipu provider in `_shared/gemini-client.ts`. Add a `ZHIPU_API_KEY` env check; if missing, transparently fall back to `google/gemini-2.5-flash` instead of trying `glm-4.7` against Google.
- **B (fast)**: hard-update ANZ's `company_ai_overrides.primary_model` to `google/gemini-2.5-flash` and remove the broken model entirely.

I recommend **B for the immediate fix** + **A as the durable fix** so future companies can't reintroduce this.

#### 6. Stop supervisor from blocking every turn
DeepSeek is returning "Insufficient Balance". `supervisor-agent` should treat this as a soft failure (already does — "proceeding without guidance") but log a single warning per hour, not per turn. Also: route supervisor to a working model (Lovable AI Gateway / Gemini) instead of DeepSeek so it actually contributes again.

#### 7. Fix attempt tracking so the cooldown works
Current code writes the marker onto the **stalled** message. But the watchdog reads the **newest** assistant message, which is the new stall — so the marker is invisible. Move the marker to **conversation-level metadata** (new column or `metadata` jsonb on `conversations`) keyed by timestamp, not by message id.

### Validation

After deploy:
1. Send "what's in stock" to ANZ → expect a real answer using `list_products` + `search_media`, no "one moment".
2. Force a stall (rare) → watchdog fulfills once within ~2 min.
3. Force a second stall → watchdog escalates to owner, pauses conversation, sends ONE customer message, stops.
4. Confirm logs show no `TypeError` in `routeToAgent` and no per-turn 404 on the model.

### Files

- `supabase/functions/whatsapp-messages/index.ts` — safe router parsing.
- `supabase/functions/pending-promise-watchdog/index.ts` — cooldown, hard cap, re-stall detection, conversation-level attempt tracking.
- `supabase/functions/_shared/gemini-client.ts` — `zai/*` normalization with safe fallback.
- `supabase/functions/supervisor-agent/index.ts` — switch off DeepSeek, throttle error logs.
- DB migration — add `conversations.last_promise_fulfillment_at timestamptz`; update ANZ `company_ai_overrides.primary_model` to `google/gemini-2.5-flash`; pause runaway conversation.

No schema-breaking changes, no new tools.

