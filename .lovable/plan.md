

## Plan: Add External AI Fallback for Demo Chat

### Problem
The Lovable AI gateway (`ai.gateway.lovable.dev`) can experience downtime. With a pitch in a few hours, we need a reliable fallback so the demo keeps working.

### Approach
You already have `OPENAI_API_KEY` configured as a secret. We'll modify the `callAIWithHistory` function in `supabase/functions/demo-session/index.ts` to try the Lovable gateway first, and if it fails (non-200, timeout, or network error), automatically retry with the OpenAI API directly.

### Technical Details

**File: `supabase/functions/demo-session/index.ts`**

Modify `callAIWithHistory` (~lines 619-666):

1. Wrap the existing Lovable gateway call in a try/catch with a timeout (8 seconds)
2. On failure, fall back to `https://api.openai.com/v1/chat/completions` using `OPENAI_API_KEY`
3. Map model names for fallback: use `gpt-4o-mini` for evaluations, `gpt-4o` for main responses
4. Log which provider was used so you can monitor during the pitch

```text
callAIWithHistory flow:
  ┌─────────────────────┐
  │ Try Lovable Gateway  │
  │ (8s timeout)         │
  └──────┬──────────────┘
         │ fail?
         ▼
  ┌─────────────────────┐
  │ Fallback: OpenAI API │
  │ using OPENAI_API_KEY │
  └─────────────────────┘
```

### Changes Summary
- **1 file edited**: `supabase/functions/demo-session/index.ts` — update `callAIWithHistory` to add OpenAI fallback with automatic failover
- No new secrets needed (`OPENAI_API_KEY` already exists)
- No database changes
- No frontend changes

