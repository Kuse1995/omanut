

# Frustration Signal Detection & Auto-Escalation

## Overview

Add a "Frustration Signal Detector" that tracks consecutive AI errors per conversation. When 2+ consecutive errors are detected (wrong image, wrong stock data, BMS failures, behavior drift), silently flag `#SYSTEM_RECALIBRATION_REQUIRED` to the Boss Agent and suggest human takeover.

## Architecture

```text
Customer msg → AI responds → Post-Response Frustration Check
                                    │
                    ┌────────────────┴────────────────┐
                    │  Count recent errors for this   │
                    │  conversation from ai_error_logs │
                    └────────────────┬────────────────┘
                                    │
                    ┌───── < 2 consecutive ──── OK, continue
                    │
              ≥ 2 consecutive errors
                    │
                    ▼
        ┌───────────────────────────┐
        │  1. Log #SYSTEM_RECAL...  │
        │  2. Silent boss notify    │
        │  3. Suggest takeover      │
        │  4. Mark conversation     │
        └───────────────────────────┘
```

## Implementation

### 1. `whatsapp-messages/index.ts` — Add frustration detection after response validation (~line 3560)

**New function: `detectFrustrationSignals`**
- Query `ai_error_logs` for the current `conversation_id`, ordered by `created_at DESC`, limit 5
- Check if the 2 most recent entries are consecutive (no successful interactions between them)
- Also detect inline frustration signals from the customer's message: repeated complaints, "you already told me wrong", "that's not what I asked", explicit frustration keywords
- Error types that count: `behavior_drift`, `wrong_stock_data`, `bms_error`, `wrong_image`, `tool_failure`, `hallucination`

**New function: `sendRecalibrationAlert`**
- Calls `send-boss-notification` with a new `system_recalibration` notification type
- Message format: `🚨 #SYSTEM_RECALIBRATION_REQUIRED\n\nConversation: [customer_name]\nPhone: [phone]\nConsecutive Errors: [count]\nError Types: [list]\n\nRecommendation: Manual human takeover advised.\n\nReply TAKEOVER [phone] to assume control.`
- Logs to `ai_error_logs` with `error_type: 'frustration_escalation'`

**Integration point** — after the response validation layer (line ~3560) and before inserting the assistant message:
- Call `detectFrustrationSignals(conversationId, company, supabase)`
- Also log errors to `ai_error_logs` when BMS tool calls fail (currently only behavior_drift is logged)

### 2. `whatsapp-messages/index.ts` — Track tool errors in existing tool execution blocks

In the BMS tool execution catch blocks (~line 3407 and similar), insert `ai_error_logs` entries with `error_type: 'tool_failure'` so the frustration detector has data to work with. Currently only `behavior_drift` is logged.

### 3. `send-boss-notification/index.ts` — Add `system_recalibration` notification type

New case in the switch statement:
```
case 'system_recalibration':
  message = `🚨 #SYSTEM_RECALIBRATION_REQUIRED\n\n...`
```

### 4. Customer frustration keyword detection

Before the AI call, scan the incoming message for frustration signals:
- "wrong", "not what I asked", "already told you", "incorrect", "you keep", "again?!", "frustrated", "useless"
- If detected AND there's at least 1 recent error in `ai_error_logs`, treat it as the 2nd consecutive error and trigger escalation immediately

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/whatsapp-messages/index.ts` | Add `detectFrustrationSignals` + `sendRecalibrationAlert` functions, log tool failures to `ai_error_logs`, integrate after response validation |
| `supabase/functions/send-boss-notification/index.ts` | Add `system_recalibration` notification type |

## No database changes needed
The existing `ai_error_logs` table has all required columns (`error_type`, `conversation_id`, `company_id`, `severity`, `analysis_details`).

