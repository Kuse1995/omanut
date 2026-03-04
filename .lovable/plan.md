

## Unify Facebook Comments into the Conversations Dashboard

### Overview
Add a `platform` column to the `conversations` table, update the meta-webhook to insert Facebook interactions into the existing conversations/messages tables, and add platform icons to the dashboard UI.

### 1. Database Migration
Add a `platform` column to the `conversations` table:
```sql
ALTER TABLE public.conversations 
ADD COLUMN platform text NOT NULL DEFAULT 'whatsapp';
```
This defaults existing rows to `'whatsapp'`. Facebook conversations will be inserted with `'facebook'`.

### 2. Update `meta-webhook` Edge Function
After the AI reply is successfully posted to Facebook, insert records into the database:

- **Find company_id**: The `meta_credentials` table has `user_id`. Query the `users` table to get the `company_id` from that user.
- **Upsert a conversation**: Create or find a conversation using the commenter's Facebook ID as a unique identifier (stored in the `phone` field as `fb:{commenter_id}` to distinguish from phone numbers). Set `platform = 'facebook'`.
- **Insert two messages**:
  1. The user's comment (`role: 'user'`)
  2. The AI's reply (`role: 'assistant'`)
- Update `last_message_preview` and `unread_count` on the conversation.

### 3. Frontend Changes

**ConversationItem.tsx** — Add a platform icon next to the customer name:
- Import `Facebook` and `MessageCircle` (or a WhatsApp-style icon) from lucide-react.
- Show a small Facebook icon (blue) when `conversation.phone?.startsWith('fb:')` or when a `platform` field equals `'facebook'`, otherwise show a WhatsApp/message icon (green).
- Place it next to the avatar or name area.

**ConversationsList.tsx** — Add a platform filter option:
- Add a `'facebook'` filter button alongside `all | unread | takeover` so users can filter by platform.

**Conversations.tsx** — Update the fetch query to include the new `platform` column in the select statement.

### 4. Display Name Handling
For Facebook conversations, the `customer_name` will be set to the commenter's Facebook name. The `phone` field will store `fb:{commenter_fb_id}` as a unique identifier (since Facebook users don't have phone numbers in this context).

