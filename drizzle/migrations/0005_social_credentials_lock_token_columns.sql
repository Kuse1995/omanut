-- Default privileges had granted full table access; keep tokens server-only.
REVOKE ALL ON public.social_credentials FROM anon, authenticated;
GRANT SELECT (id, company_id, platform, account_id, account_name, account_type, token_expires_at, environment, created_at, updated_at)
  ON public.social_credentials TO authenticated;
REVOKE ALL ON public.social_oauth_sessions FROM anon, authenticated;