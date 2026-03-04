

## Analysis

You're absolutely right. Currently `meta_credentials` is scoped to `user_id` (individual user), not `company_id`. This means:
- Credentials aren't shared across team members of the same company
- The webhook has to do a convoluted lookup: `meta_credentials.user_id` → `users.company_id` to resolve the company
- If the user who created the credential leaves, the integration breaks
- Multiple companies can't each have their own Facebook/Instagram pages properly isolated

## Plan: Make Meta Credentials Company-Scoped

### 1. Database Migration
Add a `company_id` column to `meta_credentials`, backfill from `users.company_id`, then update RLS:

```sql
-- Add company_id column
ALTER TABLE public.meta_credentials ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;

-- Backfill from users table
UPDATE public.meta_credentials mc
SET company_id = u.company_id
FROM public.users u
WHERE mc.user_id = u.id;

-- Make it NOT NULL after backfill
ALTER TABLE public.meta_credentials ALTER COLUMN company_id SET NOT NULL;

-- Drop old user-scoped RLS policies
DROP POLICY IF EXISTS "Users can view own meta credentials" ON public.meta_credentials;
DROP POLICY IF EXISTS "Users can insert own meta credentials" ON public.meta_credentials;
DROP POLICY IF EXISTS "Users can update own meta credentials" ON public.meta_credentials;
DROP POLICY IF EXISTS "Users can delete own meta credentials" ON public.meta_credentials;

-- New company-scoped RLS policies
CREATE POLICY "Company members can view meta credentials"
  ON public.meta_credentials FOR SELECT TO authenticated
  USING (user_has_company_access_v2(company_id));

CREATE POLICY "Managers can insert meta credentials"
  ON public.meta_credentials FOR INSERT TO authenticated
  WITH CHECK (has_company_role(company_id, 'manager'::company_role));

CREATE POLICY "Managers can update meta credentials"
  ON public.meta_credentials FOR UPDATE TO authenticated
  USING (has_company_role(company_id, 'manager'::company_role));

CREATE POLICY "Owners can delete meta credentials"
  ON public.meta_credentials FOR DELETE TO authenticated
  USING (has_company_role(company_id, 'owner'::company_role));
```

Keep the existing admin policy as-is.

### 2. Edge Function: `meta-webhook/index.ts`
- **Simplify `resolveCompanyId`**: Read `company_id` directly from `meta_credentials` instead of the multi-hop `user_id → users → company_id` lookup.
- Update `getPageCredentials` to also return `company_id` in one query, eliminating the second call.

### 3. Frontend: `MetaIntegrationsPanel.tsx`
- Use `useCompany()` to get `selectedCompany.id`
- Insert with `company_id` instead of `user_id`
- Filter queries by `company_id` so each company sees only its own credentials
- Keep `user_id` as an audit field (who created it) but scope visibility to company

### Files Changed

| Action | File |
|--------|------|
| Migration | Add `company_id` to `meta_credentials`, update RLS |
| Edit | `supabase/functions/meta-webhook/index.ts` |
| Edit | `src/components/admin/MetaIntegrationsPanel.tsx` |

