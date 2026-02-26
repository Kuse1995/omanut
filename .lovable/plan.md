

## Plan: Don't activate human takeover on soft handoffs

### Problem
When the AI asks a follow-up question (e.g., "what's your reference number?"), the handoff evaluator runs in the background and triggers a `soft_handoff` because the customer reported a failed transaction. This sets `human_takeover = true` on the conversation. When the customer replies with the reference number, the AI is blocked from responding because the takeover guard kicks in.

### Root Cause
Line 449-455 in `demo-session/index.ts`: `human_takeover` is set to `true` for ALL handoff types (both soft and hard). Soft handoffs should let the AI continue chatting while notifying the boss in the background.

### Fix

**File: `supabase/functions/demo-session/index.ts`**

1. **Only set `human_takeover = true` for hard handoffs** — Change the block at lines 449-455 to only update the conversation when `result.decision === 'hard_handoff'`. Soft handoffs will still create tickets, queue items, and notify the boss, but the AI keeps responding.

2. **Add a flag to the handoff evaluation prompt** telling the evaluator: if the AI is still actively collecting information (asking follow-up questions), return `"none"` even if the issue type would normally warrant a soft handoff. The handoff should only trigger once the AI has finished its information gathering.

### Summary

| Handoff Type | Before | After |
|---|---|---|
| `soft_handoff` | Sets `human_takeover = true`, AI stops | Ticket + boss notification created, AI **keeps chatting** |
| `hard_handoff` | Sets `human_takeover = true`, AI stops | Same — AI stops, human takes over |

### Files
| Action | File |
|---|---|
| Edit | `supabase/functions/demo-session/index.ts` |

