

# Sort Conversations by Most Recent Activity (WhatsApp-style)

## Problem
Conversations are currently sorted by `started_at` (when the conversation was created), not by the latest message. This means old conversations stay at the bottom even if they just received a new message.

## Solution

### Step 1: Add `last_message_at` column to conversations table
- Add a `last_message_at` timestamp column (defaults to `started_at`)
- Create a database trigger that automatically updates `last_message_at` on the conversations row whenever a new message is inserted into the `messages` table
- Backfill existing conversations with their latest message timestamp

### Step 2: Update query ordering in `src/pages/Conversations.tsx`
- Change `.order('started_at', { ascending: false })` to `.order('last_message_at', { ascending: false })`
- Keep pinned conversations on top (existing behavior)

### Files Modified
- **Database migration** -- new column + trigger + backfill
- **`src/pages/Conversations.tsx`** -- update sort order (line 72)

