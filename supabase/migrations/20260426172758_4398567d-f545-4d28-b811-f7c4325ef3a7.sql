-- Temporary session storage for Meta OAuth flow (Page tokens never touch the browser)
CREATE TABLE public.meta_oauth_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  company_id UUID NOT NULL,
  pages JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes')
);

CREATE INDEX idx_meta_oauth_sessions_user ON public.meta_oauth_sessions(user_id);
CREATE INDEX idx_meta_oauth_sessions_expires ON public.meta_oauth_sessions(expires_at);

ALTER TABLE public.meta_oauth_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own oauth sessions"
ON public.meta_oauth_sessions FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own oauth sessions"
ON public.meta_oauth_sessions FOR DELETE
USING (user_id = auth.uid());

CREATE POLICY "Service role full access on meta oauth sessions"
ON public.meta_oauth_sessions FOR ALL
TO service_role
USING (true) WITH CHECK (true);

-- Add health tracking to existing meta_credentials
ALTER TABLE public.meta_credentials
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS health_status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS page_name TEXT,
  ADD COLUMN IF NOT EXISTS page_picture_url TEXT,
  ADD COLUMN IF NOT EXISTS connected_via TEXT NOT NULL DEFAULT 'manual';