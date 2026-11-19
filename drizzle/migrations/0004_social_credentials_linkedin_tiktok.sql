CREATE TABLE public.social_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('linkedin', 'tiktok')),
  account_id text NOT NULL,
  account_name text,
  account_type text CHECK (account_type IN ('person', 'organization', 'creator')),
  access_token text NOT NULL,
  refresh_token text,
  token_expires_at timestamptz,
  refresh_expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT '{}',
  environment text NOT NULL DEFAULT 'production' CHECK (environment IN ('production', 'sandbox')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_credentials_company_platform_account_key UNIQUE (company_id, platform, account_id)
);
CREATE INDEX social_credentials_company_platform_idx ON public.social_credentials (company_id, platform);

-- Tokens are never readable from the browser: authenticated users get only the safe columns.
GRANT SELECT (id, company_id, platform, account_id, account_name, account_type, token_expires_at, environment, created_at, updated_at)
  ON public.social_credentials TO authenticated;
GRANT ALL ON public.social_credentials TO service_role;
ALTER TABLE public.social_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company managers and platform admins can see social connections"
  ON public.social_credentials FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'manager') OR public.has_role(auth.uid(), 'admin'));

-- Short-lived OAuth handshakes (state nonce + PKCE verifier). Server-only.
CREATE TABLE public.social_oauth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('linkedin', 'tiktok')),
  code_verifier text,
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.social_oauth_sessions TO service_role;
ALTER TABLE public.social_oauth_sessions ENABLE ROW LEVEL SECURITY;