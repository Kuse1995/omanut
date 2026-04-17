CREATE TABLE IF NOT EXISTS public.mcp_active_company (
  api_key_id uuid NOT NULL,
  session_id text NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (api_key_id, session_id)
);

ALTER TABLE public.mcp_active_company ENABLE ROW LEVEL SECURITY;

-- Service role only (no policies = no client access). Edge function uses service role key.
CREATE INDEX IF NOT EXISTS idx_mcp_active_company_updated ON public.mcp_active_company(updated_at);