

# Fix: Truncated AI Replies on Comments + DM Response Issues

## Findings

### Issue 1: Truncated comment replies
The `generateAIReply` function in `meta-webhook` uses `max_tokens: 300`. This is far too low — Gemini often needs 500-800 tokens for a complete, natural reply. The system prompt (company identity, knowledge base, documents) consumes significant context, and 300 output tokens causes mid-sentence cutoffs.

### Issue 2: DMs — mixed results
The edge function logs show **Messenger DMs ARE working** (the "Hello" message got a successful reply). However, the `max_tokens: 300` limit likely truncates longer DM responses too. For **Instagram DMs**, the webhook subscription in `subscribe-meta-page` only subscribes to `feed` and `messages` — but Instagram DM events require the `instagram_manage_messages` permission on the token AND may not arrive unless explicitly subscribed.

## Changes

### File: `supabase/functions/meta-webhook/index.ts`

**1. Increase `max_tokens` from 300 to 1024**

In the `generateAIReply` function (line 779), change:
```typescript
max_tokens: 300,  →  max_tokens: 1024,
```

This gives the AI enough room to complete its thoughts for all contexts (comments, Messenger, Instagram).

**2. Add conversation history for DMs**

Currently, DM replies have zero conversation context — each message is handled in isolation. Load the last 6 messages from the conversation before generating a reply, so the AI can maintain coherent multi-turn conversations. This applies to `handleMessengerDM` and `handleInstagramDM`.

Before calling `generateAIReply`, fetch recent messages:
```typescript
const { data: history } = await supabase
  .from('messages')
  .select('role, content')
  .eq('conversation_id', conversationId)
  .order('created_at', { ascending: true })
  .limit(6);
```

Pass this history into `generateAIReply` so the AI sees prior context.

**3. Update `generateAIReply` to accept optional history**

Add an optional `history` parameter. When provided, prepend the conversation history to the messages array sent to Gemini, giving the AI full context for DM conversations.

### File: `supabase/functions/subscribe-meta-page/index.ts`

**4. Add `instagram_manage_messages` subscription field**

Currently subscribes to `["feed", "messages"]`. For Instagram DMs to arrive via the page webhook, the subscription needs the `instagram_manage_messages` field as well. Update to:
```typescript
const fields = ["feed", "messages", "instagram_manage_messages"];
```

## Summary

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Truncated comment replies | `max_tokens: 300` too low | Increase to `1024` |
| Truncated DM replies | Same token limit | Same fix |
| No conversation context in DMs | History not loaded | Load last 6 messages |
| Instagram DMs not arriving | Missing webhook subscription field | Add `instagram_manage_messages` |

### Files Modified

| File | Change |
|------|--------|
| `supabase/functions/meta-webhook/index.ts` | Increase max_tokens, add DM conversation history |
| `supabase/functions/subscribe-meta-page/index.ts` | Add instagram_manage_messages subscription field |

### Post-deployment note
After the subscription function is updated, you'll need to re-trigger the subscription for the Finch page (re-save Meta credentials in the admin panel) so the new fields take effect.

