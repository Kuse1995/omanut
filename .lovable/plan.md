

## Problem: AI Sends "Technical Difficulties" Instead of Actually Helping

The AI catches errors during processing and sends a hardcoded "I apologize, but I'm experiencing some technical difficulties" message to the customer (line 4120). This counts as a "response sent" so the watchdog never fires. The customer gets a useless message and no follow-up.

The root issue is **no retry strategy** — when the AI call fails (API error, timeout, tool crash), it immediately gives up and sends a dead-end message.

## Solution: Retry-First Error Recovery

### Change 1: Retry with simpler configuration before giving up

In the catch block at line 4117, instead of immediately setting `assistantReply` to "technical difficulties":

1. **Retry with fallback model** (`glm-4.7`) and no tools (remove tool_calls to eliminate tool-related crashes)
2. **Retry with truncated context** — only last 3 messages + system prompt (in case context length caused the failure)
3. **Only if both retries fail**, use the company's configured `fallbackMessage` (from `company_ai_overrides`) instead of the hardcoded generic text

```text
Error occurs
  → Retry 1: fallback model, no tools, same context
    → Retry 2: fallback model, no tools, truncated context (last 3 msgs)
      → Final: send company's configured fallback message + notify boss
```

### Change 2: Replace hardcoded error message with company fallback

The `fallbackMessage` variable is already loaded from `company_ai_overrides` at line 2060 but never used in the catch block. Replace the hardcoded text at line 4120 with this configurable message.

### Change 3: Log the original error before retrying

Before retrying, log the original error to `ai_error_logs` with type `ai_call_failed` so you can monitor what's causing failures.

---

## Files to Change

| File | Change |
|------|--------|
| `whatsapp-messages/index.ts` | Replace catch block at line 4117 with retry logic (retry with simpler model + no tools, then truncated context, then configured fallback message) |

This is ~30 lines replacing ~4 lines in a single catch block. No new files, no migrations needed.

## Technical Detail

The retry approach strips tools because tool-calling is the most common failure mode (malformed tool calls, tool execution crashes). A no-tools retry with a simple model gives the AI the best chance of generating a useful conversational response even when the full pipeline fails.

