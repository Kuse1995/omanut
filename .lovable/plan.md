

## Problem

When deleting a company, the `delete_company` RPC function tries to delete `auth.users` records but has ordering/constraint issues:

1. **`users` table FK**: `public.users.company_id` references `companies(id)` **without `ON DELETE CASCADE`**. The function deletes `public.users` rows *before* `companies`, which should work — but the `auth.users` deletion happens in two separate loops (one for `company_users`-only members, one for legacy `users` table members), creating race conditions.

2. **`users.email` unique constraint**: `users_email_key` on `public.users.email` means if a deleted company's user row isn't fully cleaned up, re-creating with the same email fails.

3. **`companies` unique constraints**: `unique_whatsapp_number_idx` and `unique_twilio_number_idx` on the `companies` table mean if the company row isn't deleted (due to FK failures), re-creating with the same number conflicts.

4. **Missing `user_roles` cleanup**: The `delete_company` function never deletes from `public.user_roles` before deleting `auth.users`. Since `user_roles.user_id` has `ON DELETE CASCADE` from `auth.users`, this *should* work — but if the `auth.users` delete fails for any reason, orphan `user_roles` rows remain.

5. **FK ordering bug**: The function deletes `public.users` rows, then tries to delete `companies`. But `public.users.company_id` → `companies(id)` has no `ON DELETE CASCADE`, so if there's any error or partial execution, the company row can't be deleted.

## Fix

Update the `delete_company` database function to:

1. **Delete `user_roles`** explicitly before deleting `auth.users` (safety net)
2. **Consolidate user deletion** — collect ALL user IDs from both `company_users` and `users` tables, deduplicate, then check each for multi-company membership before deleting from `auth.users`
3. **Delete `public.users` rows before `companies`** (already done, but ensure it's robust)
4. **Add missing table cleanups** for any new tables like `support_tickets`, `ticket_notes`, `company_departments`

### Migration SQL

A single migration to replace the `delete_company` function with a more robust version that:
- Collects all user IDs upfront from both `company_users` and `users` tables
- Explicitly deletes `user_roles` for those users
- Deletes `auth.users` only for single-company users
- Cleans up `support_tickets`, `ticket_notes`, `company_departments` (missing from current function)
- Ensures proper ordering so no FK violations occur

| Action | Target |
|---|---|
| DB Migration | Replace `delete_company` function |

