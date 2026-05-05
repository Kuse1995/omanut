ALTER TABLE public.openclaw_events
  ADD COLUMN IF NOT EXISTS last_trigger_at timestamptz,
  ADD COLUMN IF NOT EXISTS trigger_count int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_openclaw_events_dispatch_pending
  ON public.openclaw_events (dispatch_status, status, created_at DESC)
  WHERE dispatch_status = 'delivered' AND status IN ('pending','processing');