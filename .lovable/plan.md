

## Plan: Add Facebook Messenger DM Handling to Meta Webhook

### Overview
Expand the `meta-webhook` edge function to route incoming payloads to either the existing comment handler or a new Messenger DM handler. Also add a `facebook_messenger` platform icon to the conversation UI.

### 1. Edge Function: `supabase/functions/meta-webhook/index.ts`

**Update `processWebhook`** to check for both `entry.changes` (comments) and `entry.messaging` (DMs):

```
for (const entry of body.entry) {
  const pageId = entry.id;

  // Handle feed comments (existing logic)
  if (entry.changes) { ... }

  // Handle Messenger DMs (new)
  if (entry.messaging) {
    for (const event of entry.messaging) {
      if (!event.message?.text) continue;  // skip read receipts, deliveries, etc.
      if (event.message?.is_echo) continue; // skip our own outgoing messages
      const senderId = event.sender.id;
      const messageText = event.message.text;
      await handleMessengerDM(supabase, pageId, senderId, messageText);
    }
  }
}
```

**Add `handleMessengerDM` function** that:
1. Looks up `access_token` and `ai_system_prompt` from `meta_credentials` using `pageId`
2. Resolves `company_id` via `meta_credentials.user_id` -> `users.company_id` (same pattern as comments)
3. Calls `generateAIReply` with a Messenger-specific user prompt (e.g., "A customer sent a direct message: ...")
4. Sends the reply via `POST https://graph.facebook.com/v25.0/me/messages` with body:
   ```json
   {
     "recipient": { "id": "<senderId>" },
     "messaging_type": "RESPONSE",
     "message": { "text": "<aiReply>" }
   }
   ```
5. Upserts a conversation with `phone: 'fbdm:{senderId}'` and `platform: 'facebook_messenger'`
6. Inserts user message + AI reply into `messages` table with `message_metadata: { source: 'facebook_messenger' }`

No 15-second delay for DMs (unlike comments, Messenger expects fast replies).

### 2. Frontend: Platform Icon for Messenger

**`ConversationItem.tsx`** — Add a third condition: if `phone` starts with `fbdm:`, show a distinct Messenger icon (using `MessageSquare` from lucide-react with a purple/blue tint) to distinguish from WhatsApp and Facebook comments.

**`ConversationsList.tsx`** and **`ConversationsPanel.tsx`** — Add a `'messenger'` filter option alongside existing `facebook` filter, matching on `phone?.startsWith('fbdm:')`.

**`ChatView.tsx`** — For `fbdm:` conversations, keep the reply input enabled (unlike Facebook comments which are read-only) since Messenger is a two-way chat. Show a "Messenger" badge in the header.

### Files Changed

| Action | File |
|--------|------|
| Edit | `supabase/functions/meta-webhook/index.ts` |
| Edit | `src/components/conversations/ConversationItem.tsx` |
| Edit | `src/components/conversations/ConversationsList.tsx` |
| Edit | `src/components/admin/ConversationsPanel.tsx` |
| Edit | `src/components/conversations/ChatView.tsx` |

