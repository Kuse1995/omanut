

## Fix: company creation fails on retry ("Email already in use")

### Root cause (confirmed from logs + DB)

Your first attempt at 19:29:40 actually **partially succeeded** then crashed:

1. ✅ Auth user created (`710eb5df...` / charleshimoondejr@gmail.com)
2. ✅ Company `GreenGrid Energy` (`a23f9137...`) inserted
3. ✅ `users` row inserted, `company_users` row inserted, `user_roles` row inserted
4. 💥 Crashed inserting into `company_ai_overrides`: **duplicate key on `company_id`**

Why the duplicate? The `companies` table has a trigger `trg_seed_company_ai_overrides` that auto-inserts a row into `company_ai_overrides` on every new company. But `create-company/index.ts` (lines 153-164) **also** explicitly inserts into `company_ai_overrides` when `system_instructions`/`qa_style`/`banned_topics` are provided in the form — colliding with the trigger's row.

The function then threw, but **none of the prior inserts were rolled back** (no transaction wrapping). So now:
- Auth user exists ✓
- `company_users` row exists ✓ → orphan check fails (`cuCount > 0`) → "Email already in use"
- Every retry hits the same wall

### Fix

#### 1. `supabase/functions/create-company/index.ts` — replace insert with upsert
The trigger already created the row with empty defaults. Change the explicit insert (lines ~153-164) to an **update** of the existing row instead of an insert:

```ts
if (system_instructions || qa_style || banned_topics) {
  const { error: aiError } = await supabaseAdmin
    .from('company_ai_overrides')
    .update({
      system_instructions: system_instructions || '',
      qa_style: qa_style || '',
      banned_topics: banned_topics || '',
    })
    .eq('company_id', company.id);

  if (aiError) throw aiError;
}
```

This way the trigger keeps seeding the baseline (model, tool rounds, tokens, enabled_tools — all the ANZ baseline defaults we set yesterday), and the form just overlays the three editable text fields.

#### 2. Wrap the multi-step creation in a cleanup path
If anything after `auth.admin.createUser` fails, the function must roll back what it created so the next retry starts clean. Add a `try/catch` around steps 2-6 that on failure:
- deletes `company_ai_overrides` row (if any)
- deletes `user_roles` row
- deletes `company_users` row
- deletes `users` row
- deletes `companies` row
- deletes auth user via `auth.admin.deleteUser`

Then re-throws so the client sees the real error.

#### 3. One-shot cleanup of the existing orphan so this user can retry now
Run a migration that removes the half-created GreenGrid Energy + its admin user:
```sql
DELETE FROM public.user_roles WHERE user_id='710eb5df-1c48-4aae-a744-1aafd5259c87';
DELETE FROM public.company_users WHERE user_id='710eb5df-1c48-4aae-a744-1aafd5259c87';
DELETE FROM public.users WHERE id='710eb5df-1c48-4aae-a744-1aafd5259c87';
DELETE FROM public.company_ai_overrides WHERE company_id='a23f9137-30b0-438d-b220-a9c5cdc265f0';
DELETE FROM public.companies WHERE id='a23f9137-30b0-438d-b220-a9c5cdc265f0';
```
Then delete the auth user from inside the edge function on first retry (the orphan-check path already handles this once `cu_count`/`users_count` are 0).

#### 4. Surface the real error to the admin UI
The current catch block returns a generic `"An error occurred processing your request"` (line 184), which is why you couldn't see the duplicate-key issue. Return the actual `error.message` for admin-only callers (this function already verifies admin role at the top, so it's safe).

### Files
- **`supabase/functions/create-company/index.ts`** — switch ai-overrides insert → update; add rollback; return real error message; redeploy.
- **DB migration** — delete the orphaned GreenGrid Energy company + admin user rows so retry works immediately.

### Validation
1. Open admin → New Company → fill the same form (charleshimoondejr@gmail.com, GreenGrid Energy) → Create.
2. Expect 200, company appears in list, admin can log in with the password set in the form.
3. `company_ai_overrides` row exists once with the baseline defaults plus the three text overrides from the form.
4. Trigger an intentional failure (e.g., duplicate phone number) → verify auth user + partial rows are cleaned up and the form can be resubmitted with the same email.

