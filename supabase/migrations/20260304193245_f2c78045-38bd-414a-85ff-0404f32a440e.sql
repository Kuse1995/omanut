
-- Add company_id column
ALTER TABLE public.meta_credentials ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;

-- Backfill from users table
UPDATE public.meta_credentials mc
SET company_id = u.company_id
FROM public.users u
WHERE mc.user_id = u.id;

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
