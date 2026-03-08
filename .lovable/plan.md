

# Fix AI Returning Empty Responses for Finch (Payment Link Requests)

## Problem
The AI returns "Thank you for your message. How can I help you today?" — the empty-reply fallback — instead of processing purchase requests. This happens because:

1. The model returns `null` content + tool_calls (normal for function calling)
2. Tool handlers push results to `toolResults` but some paths don't set `assistantReply`
3. The multi-round tool loop uses `currentToolCalls` from the initial response, but when it's passed to the next AI call with `tool_calls: undefined`, the API call fails silently
4. The fallback empty-reply message fires

Additionally, the routing sometimes incorrectly sends payment intents to `boss` before the safety override catches it, poisoning the transcript with handoff messages.

## Root Causes

### 1. Multi-round loop crash when tool_calls structure is malformed
Line 3128: `tool_calls: currentToolCalls` — if the initial AI response has tool_calls but the loop variable isn't properly validated, the subsequent AI call gets malformed input.

### 2. Transcript pollution from repeated failures
Once the first failure occurs, the transcript accumulates "How can I help you today?" responses, which further confuse the model on subsequent attempts.

### 3. Missing `assistantReply` after BMS tool execution
The `check_stock`, `record_sale`, and `generate_payment_link` handlers (lines 2965-3081) push to `toolResults` but never set `assistantReply`. They rely on the multi-round loop to get the AI to generate a reply from tool results — but if that loop fails, there's no reply.

## Fix

### `supabase/functions/whatsapp-messages/index.ts`

**Change 1 — Validate tool_calls before multi-round loop (around line 3114)**

```typescript
let currentToolCalls = aiData?.choices?.[0]?.message?.tool_calls;

// Validate tool_calls structure
if (currentToolCalls && !Array.isArray(currentToolCalls)) {
  console.warn('[TOOL-LOOP] Invalid tool_calls structure, skipping loop');
  currentToolCalls = null;
}
```

**Change 2 — Add safety fallback after multi-round loop (around line 3258)**

If tools executed successfully but `assistantReply` is still empty, generate a meaningful response instead of the generic greeting:

```typescript
if (!assistantReply || assistantReply.trim() === '') {
  if (anyToolExecuted && toolExecutionContext.length > 0) {
    assistantReply = "I've processed your request. Is there anything else I can help you with?";
    console.log('[FALLBACK] Tools executed but no reply generated. Context:', toolExecutionContext);
  } else {
    // Check if the user message is about purchasing
    const lowerUserMsg = userMessage.toLowerCase();
    const isPurchaseIntent = /buy|purchase|order|payment link|pay/i.test(lowerUserMsg);
    if (isPurchaseIntent) {
      assistantReply = "I'd love to help you with your purchase! Could you let me know which product you're interested in? I can then provide you with the details and payment link.";
    } else {
      assistantReply = fallbackMessage;
    }
    console.log('[FALLBACK] No AI response generated, using contextual fallback');
  }
}
```

**Change 3 — Add error resilience in multi-round loop (around line 3123)**

Wrap the assistant message construction to handle null/undefined tool_calls:

```typescript
currentMessages = [
  ...currentMessages,
  {
    role: "assistant",
    content: assistantReply || null,
    ...(currentToolCalls && currentToolCalls.length > 0 ? { tool_calls: currentToolCalls } : {})
  },
  ...toolResults
];
```

**Change 4 — Better error logging after initial AI call (around line 1935)**

```typescript
assistantReply = aiData.choices[0].message.content || '';
const toolCalls = aiData.choices[0].message.tool_calls;

if (!assistantReply && (!toolCalls || toolCalls.length === 0)) {
  console.warn('[AI-RESPONSE] Model returned empty content and no tool calls');
}
```

## Summary

| File | Changes |
|------|---------|
| `supabase/functions/whatsapp-messages/index.ts` | 4 changes: validate tool_calls, contextual fallback for purchase intent, resilient multi-round loop message construction, better error logging |

