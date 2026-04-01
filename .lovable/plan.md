

# Fix: Conversations Page Not Showing Messages

## Root Cause

The Conversations page (`src/pages/Conversations.tsx`) queries the legacy `users` table to get the logged-in user's `company_id` (line 55-59). However, the currently logged-in user (`30a33c2b-...`) has **no record in the `users` table** — they only exist in `auth.users`.

The rest of the app uses `CompanyContext` which calls the `get_user_companies()` RPC (querying `company_users` junction table). The Conversations page bypasses this and hits a dead end.

## Fix

### Update `src/pages/Conversations.tsx`

Replace the manual `users` table lookup with the `CompanyContext`:

1. Import and use `useCompany()` from `CompanyContext`
2. Get `selectedCompany` from context instead of querying `users` table
3. Use `selectedCompany.id` as the `company_id` for all conversation queries
4. Remove the redundant auth session + users table lookup from `fetchConversations`
5. Add a guard: if no selected company, show a message instead of silently failing

This aligns the Conversations page with how every other page in the app resolves the current company.

## Files to Edit

| File | Change |
|------|--------|
| `src/pages/Conversations.tsx` | Replace `users` table query with `useCompany()` context |

