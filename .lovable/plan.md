
I checked again, and there is a real bug here.

What I found:
- Abraham exists in the database for Omanut Technologies:
  - phone: `whatsapp:+260967254226`
  - customer: `Abraham`
  - `last_message_at`: `2026-03-28 17:36:17+00`
- The main conversations page was updated to sort by `last_message_at`, but there is another conversations screen still using the old logic:
  - `src/pages/Conversations.tsx` -> already uses `.order('last_message_at', { ascending: false })`
  - `src/components/admin/ConversationsPanel.tsx` -> still uses `.order('started_at', { ascending: false }).limit(50)`

Why Abraham can disappear:
- Abraham’s conversation started on `2026-01-23`
- If a screen sorts by `started_at` and only loads the latest 50 started conversations, older threads with fresh replies get pushed out
- So in one part of the app he can be missing even though he recently interacted

Plan
1. Fix the remaining conversations view
- Update `src/components/admin/ConversationsPanel.tsx` to sort by:
  - pinned first
  - then `last_message_at DESC`
- Add the same archived filtering used elsewhere so both screens behave consistently

2. Standardize conversation fetching
- Make both conversation UIs use the same query fields and ordering
- Remove the mismatch where one screen uses recent activity and the other uses conversation creation date

3. Align company scoping
- The app currently mixes two patterns:
  - direct `users.company_id` lookup
  - selected company context
- I will make the conversations screens use the active company context consistently so the visible chats match the company the user is actually working in

4. Verify the exact Abraham case
- Confirm that `0967254226` / `+260967254226` appears in the first loaded results
- Confirm it shows at or near the top after the latest interaction
- Confirm it appears in both the admin conversations panel and the standalone conversations page

Technical details
- No new database migration is needed for this fix because `last_message_at` already exists
- The main issue is frontend inconsistency between:
  - `src/pages/Conversations.tsx`
  - `src/components/admin/ConversationsPanel.tsx`
- Optional hardening: normalize phone search so local input like `0967254226` and international format `+260967254226` always match the same record
