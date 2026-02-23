
-- Create company_api_keys table
CREATE TABLE public.company_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  key_hash text NOT NULL,
  key_prefix text NOT NULL,
  name text NOT NULL DEFAULT 'Default',
  scopes text[] NOT NULL DEFAULT '{*}',
  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

-- Index for fast hash lookups
CREATE INDEX idx_company_api_keys_hash ON public.company_api_keys (key_hash);
CREATE INDEX idx_company_api_keys_company ON public.company_api_keys (company_id);

-- Enable RLS
ALTER TABLE public.company_api_keys ENABLE ROW LEVEL SECURITY;

-- Platform admins full access
CREATE POLICY "Platform admins full access to api keys"
ON public.company_api_keys FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Company owners/managers can view their keys
CREATE POLICY "Company owners/managers can view api keys"
ON public.company_api_keys FOR SELECT
USING (has_company_role(company_id, 'manager'::company_role));

-- Company owners/managers can create keys
CREATE POLICY "Company owners/managers can create api keys"
ON public.company_api_keys FOR INSERT
WITH CHECK (has_company_role(company_id, 'manager'::company_role));

-- Company owners/managers can update (revoke) keys
CREATE POLICY "Company owners/managers can update api keys"
ON public.company_api_keys FOR UPDATE
USING (has_company_role(company_id, 'manager'::company_role));

-- Company owners can delete keys
CREATE POLICY "Company owners can delete api keys"
ON public.company_api_keys FOR DELETE
USING (has_company_role(company_id, 'owner'::company_role));
