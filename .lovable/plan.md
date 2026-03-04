

## Problem

`omanut25@gmail.com` exists in `auth.users` (id: `f385f573-9c52-4e3a-b851-ccfb21727401`) but has zero entries in `public.users`, `company_users`, or `user_roles`. The `delete_company` function deleted all public-schema rows but failed to delete the `auth.users` record, likely due to a timing issue in the transaction.

## Fix (two parts)

### 1. Immediate cleanup — delete the orphaned auth user

Use the `create-company` edge function's admin client pattern to delete this orphan so the email is freed immediately. This is a one-time data fix.

### 2. Make `create-company` resilient to orphans

**File: `supabase/functions/create-company/index.ts`**

Before calling `supabaseAdmin.auth.admin.createUser()`, check if an auth user with this email already exists. If it does AND has no `company_users` or `public.users` memberships, delete the orphan first, then proceed with creation. This prevents the "email already registered" error from ever blocking company creation again.

Logic:
```
1. List auth users by email
2. If found AND no rows in company_users/users → delete auth user
3. Proceed with createUser as normal
```

This is ~15 lines added before the existing `createUser` call. No other files need changes.

| Action | Target |
|---|---|
| Edit | `supabase/functions/create-company/index.ts` — add orphan cleanup before `createUser` |

