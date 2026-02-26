

## Plan: Fix "Demo Not Live" Issue (Two Root Causes)

### Root Cause Analysis
The user is NOT getting "demo not live" — they're getting **"Demo service temporarily unavailable"** because:

1. **Human takeover is stuck ON** for phone `+260967254226`. The conversation has `human_takeover = true` from a previous agent interaction, and it was never released back to AI.
2. **Missing `reply` field in takeover response**: When `human_takeover` is active, `demo-session` returns `{ success: true, mode: 'human_takeover' }` with no `reply` field. The `whatsapp-messages` function then falls back to `demoData.reply || 'Demo service temporarily unavailable.'`

### Fixes (1 file)

**File: `supabase/functions/demo-session/index.ts`**

1. **Return a proper `reply` in human_takeover mode** (~line 102): Change the response to include a `reply` field like `"Your message has been received. A human agent is reviewing your case and will respond shortly."` so the customer gets a meaningful message instead of the generic error.

2. **Add boss command to release takeover** (~line 37-42 area): Add a new boss command `UNMUTE` or `RELEASE` that sets `human_takeover = false` and `is_paused_for_human = false` on all active conversations for the demo company, allowing the AI to resume responding.

3. **Auto-release takeover on ERASE**: When the boss runs `ERASE`, also reset `human_takeover` and `is_paused_for_human` on all conversations so a fresh demo starts clean.

### Immediate Data Fix
Additionally, a database query will reset the stuck `human_takeover` flag on the current active conversation so the demo works immediately without waiting for code deployment.

### Changes Summary
- **1 file edited**: `supabase/functions/demo-session/index.ts`
- **1 database fix**: Reset `human_takeover` on stuck conversation
- No frontend changes

