

# Fix Meta Webhook AI: Stop Consultant-Style Replies

## Root Cause
The system prompt (lines 360-367) is correct, but the **user-facing prompt** (lines 856-861) undermines it:

```
messenger: `A customer sent a direct message on Facebook Messenger:\n\n"${userMessage}"\n\nWrite a helpful reply.`
```

The phrase "Write a helpful reply" makes the model think it's being asked to **advise on writing**, not to **be the business replying**. This is why it outputs "When a customer says hello, the best approach is..." instead of actually greeting the customer.

## Fix

### `supabase/functions/meta-webhook/index.ts`

**Lines 856-861** — Rewrite the `contextPrompts` to frame the AI as the business directly replying, not writing about replying:

```typescript
const contextPrompts: Record<string, string> = {
  comment: `"${commenterName}" commented on your post: "${userMessage}"\n\nReply to them now.`,
  messenger: `Customer says: "${userMessage}"\n\nReply to them now.`,
  instagram_comment: `"${commenterName}" commented on your post: "${userMessage}"\n\nReply to them now.`,
  instagram_dm: `Customer says: "${userMessage}"\n\nReply to them now.`,
};
```

Key changes:
- Remove "A user named..." / "A customer sent..." framing — too detached
- Change "Write a helpful reply" → "Reply to them now" — direct action, not meta-instruction
- Shorter prompts reduce the model's tendency to elaborate

Then **redeploy** the function.

| File | Change |
|------|--------|
| `supabase/functions/meta-webhook/index.ts` | Rewrite user prompts (lines 856-861) to be direct reply instructions |

