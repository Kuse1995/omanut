

## Problem: AI Silently Fails and Leaves Customers Hanging

After deep analysis of `whatsapp-messages/index.ts` (5,625 lines), I identified **5 failure modes** where the AI can go silent:

### Root Causes

1. **EdgeRuntime.waitUntil silently swallows crashes** (line 5593): The entire `processAIResponse` function runs in background via `EdgeRuntime.waitUntil()`. If it crashes before reaching the outer catch block at line 4365 (e.g., during data fetch, routing, or supervisor call), the customer gets nothing. The outer catch does send a fallback, but many inner failures (like routing errors at line 1375 or tool loop errors) just `continue` or `return` without sending any message.

2. **No timeout-based safety net**: The `responseTimeout` (line 2480) only aborts the AI model call. If the *entire* background processing takes too long (routing + supervisor + tools + AI call + Twilio send), there's no global watchdog. The customer waits forever.

3. **No follow-up for dropped messages**: When a message fails silently, there's no cron job or queue that detects "customer sent a message but never got a response" and retries or alerts.

4. **Tool loop can silently exit**: The multi-round tool loop (lines 4000-4168) can break without setting `assistantReply`, and while there's a fallback at line 4182, it only catches empty replies — not cases where the function crashes mid-tool-execution.

5. **No dead letter queue**: Failed messages aren't logged to a retriable queue. They're just lost.

---

## Solution: 3-Layer Resilience System

### Layer 1: Global Timeout Watchdog in processAIResponse

Wrap the entire `processAIResponse` in a `Promise.race` with a hard 55-second deadline. If processing exceeds 55s:
- Send the customer a configurable fallback message via Twilio
- Log the timeout to `ai_error_logs`
- Notify the boss
- Mark conversation for human takeover

This catches ALL failure modes — not just the AI call timeout.

### Layer 2: Unanswered Message Detection Cron

Create a new edge function `check-unanswered` that runs every 5 minutes via pg_cron:
- Query conversations where the last message is from `user` AND is older than 3 minutes AND no `assistant` message exists after it
- For each unanswered conversation:
  - Send the customer the company's fallback message
  - Log to `ai_error_logs` with type `unanswered_message`
  - Notify the boss with customer details
  - Optionally retry the AI call once

This is the **ultimate safety net** — even if the edge function crashes completely, the cron picks up the slack.

### Layer 3: Structured Error Recovery in processAIResponse

Harden the existing error handling:
- Wrap the routing call (line 1228) in its own try/catch that falls back to `sales` AND still continues processing
- Wrap the supervisor call in its own try/catch
- Add a `finally` block at the end of `processAIResponse` that checks if any response was sent to the customer. If not, send the fallback.
- Log every silent failure to `ai_error_logs` for monitoring

---

## Files to Change

| File | Change |
|------|--------|
| `whatsapp-messages/index.ts` | Add global timeout watchdog wrapping processAIResponse; add `finally` block to guarantee customer gets a response; harden inner error handling |
| New: `check-unanswered/index.ts` | Cron function to detect and recover unanswered messages |
| Migration SQL | pg_cron job for `check-unanswered` every 5 minutes |

## Key Implementation Details

**Global watchdog** (~15 lines added to processAIResponse):
```
const HARD_TIMEOUT_MS = 55000;
const processingPromise = actualProcessing();
const timeoutPromise = new Promise(resolve => 
  setTimeout(() => resolve('TIMEOUT'), HARD_TIMEOUT_MS)
);
const result = await Promise.race([processingPromise, timeoutPromise]);
if (result === 'TIMEOUT') {
  // send fallback, notify boss, log error
}
```

**Finally block** (~20 lines at end of processAIResponse):
Tracks whether a Twilio message was successfully sent. If the function exits without sending anything, fires the fallback message.

**check-unanswered cron** (~80 lines):
Queries for conversations where last message is `user` role and older than 3 min with no subsequent `assistant` message. Sends fallback + boss notification for each.

