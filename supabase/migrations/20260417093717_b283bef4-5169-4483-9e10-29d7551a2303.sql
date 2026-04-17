-- Add scope to company_api_keys
ALTER TABLE public.company_api_keys
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'company'
  CHECK (scope IN ('company', 'admin'));

-- Allow company_id to be NULL for admin-scoped keys
ALTER TABLE public.company_api_keys
  ALTER COLUMN company_id DROP NOT NULL;

-- Add a check: company-scoped keys require company_id; admin-scoped keys must NOT have one
ALTER TABLE public.company_api_keys
  DROP CONSTRAINT IF EXISTS company_api_keys_scope_company_id_check;

ALTER TABLE public.company_api_keys
  ADD CONSTRAINT company_api_keys_scope_company_id_check
  CHECK (
    (scope = 'company' AND company_id IS NOT NULL) OR
    (scope = 'admin'   AND company_id IS NULL)
  );

-- Index for fast lookup by scope
CREATE INDEX IF NOT EXISTS idx_company_api_keys_scope ON public.company_api_keys(scope);