ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS openclaw_consecutive_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS openclaw_last_failure_at timestamptz,
  ADD COLUMN IF NOT EXISTS openclaw_auto_disabled_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_openclaw_events_status_dispatch_created
  ON public.openclaw_events (status, dispatch_status, created_at DESC);