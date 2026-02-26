

## Plan: Prevent AI from responding when conversation is in human takeover mode

### Problem
When an agent sends a message to a client via the web workspace and the client replies, the `demo-session` edge function processes the incoming message and generates an AI response immediately — it never checks whether the conversation is in `human_takeover` mode. The agent gets no chance to respond first.

### Root Cause
In `supabase/functions/demo-session/index.ts`, around lines 83-116, the function:
1. Gets/creates the conversation
2. Saves the customer message
3. Immediately calls the AI and saves the AI response

There is **no check** for `human_takeover` or `is_paused_for_human` on the conversation before generating the AI response.

### Solution
Modify `demo-session/index.ts` to:

1. **Update `getOrCreateConversation`** to also return the `human_takeover` and `is_paused_for_human` flags (not just the `id`)
2. **Add a guard** after saving the customer message: if `human_takeover` is `true`, skip AI response generation entirely — just save the incoming message and return an empty 200 response (the message is stored in DB and will appear in the agent workspace via the live feed polling)
3. **Still store the message** so the agent can see it in the workspace, but do NOT generate or send an AI reply

### Technical Details

**File: `supabase/functions/demo-session/index.ts`**

- Modify `getOrCreateConversation` (~line 501) to `select('id, human_takeover, is_paused_for_human')` and return an object instead of just a string
- Add a check after line 93 (after saving the customer message): if the conversation has `human_takeover === true`, update `last_message_preview` and return a no-op response without calling the AI
- The ticket status query path (lines 67-81) should also respect this check

### Changes Summary
- **1 file edited**: `supabase/functions/demo-session/index.ts`
- No database changes
- No frontend changes

