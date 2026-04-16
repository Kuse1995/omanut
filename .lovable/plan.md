

## Fix: Hybrid Mode Over-Escalating Simple Payment Questions

### Root Cause

ANZ's `service_mode` is set to `hybrid`. In hybrid mode, any message classified as "complex" skips the AI entirely and creates a support ticket + sends "Thank you for your patience. Someone will respond shortly."

The complexity classifier at line 291 has `/pay|payment|invoice|receipt|transaction|quotation|quote|estimate|proforma/i` in `complexTriggers`. So:
- "Are payments cash only?" → matches `pay` → **complex** → ticket TKT-002
- "What payment services do you offer" → matches `payment` → **complex** → another ticket + repeated patience messages
- "Are the juice dispensers still available?" → no complex match → **simple** → AI responds correctly

### Fix

Two changes in `supabase/functions/whatsapp-messages/index.ts`:

**1. Refine the complexity classifier (line 291)**

Move payment-related inquiry patterns from `complexTriggers` to `simpleTriggers`. The complex triggers should only match payment *actions* (wanting to pay, process a transaction), not payment *questions* (asking about payment methods).

- Remove generic `/pay|payment/` from complex triggers
- Keep action-oriented patterns: `/make.*payment|pay for|process.*payment|generate.*invoice|create.*quotation/i`
- Add question patterns to simple triggers: `/what.*payment|payment.*method|cash only|how.*pay|accept.*payment/i`

**2. Add a question-detection override (before the hybrid check)**

If the message is clearly a question (starts with "what", "how", "do you", "are", "can I", etc.) AND the complexity was classified based solely on keyword match, downgrade it to simple. Questions about a topic are not the same as requesting action on that topic.

```text
Logic:
  isQuestion = /^(what|how|do|does|are|is|can|which|where|when|why)\b/i
  if (isQuestion && messageComplexity === 'complex') → reclassify as 'simple'
```

This ensures hybrid mode only escalates actual complex *requests* (booking, complaints, order issues) — not simple informational questions that happen to contain payment/order keywords.

### Expected Result
- "Are payments cash only?" → simple → AI answers directly about payment methods
- "What payment services do you offer" → simple → AI answers directly
- "I want to pay for my order" → complex → still routes to human in hybrid mode (action, not question)
- "I have a complaint about my payment" → complex → still escalates (complaint keyword)

### Files Changed
- `supabase/functions/whatsapp-messages/index.ts` — refine `classifyMessageComplexity` function

No database migration needed.

