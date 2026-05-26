
CREATE TABLE public.openclaw_pull_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  called_at timestamptz NOT NULL DEFAULT now(),
  endpoint text NOT NULL,
  company_id uuid,
  events_returned int NOT NULL DEFAULT 0,
  wait_seconds int,
  status_code int NOT NULL DEFAULT 200,
  user_agent text,
  remote_ip text
);
CREATE INDEX idx_openclaw_pull_log_called_at ON public.openclaw_pull_log (called_at DESC);
GRANT SELECT ON public.openclaw_pull_log TO authenticated;
GRANT ALL ON public.openclaw_pull_log TO service_role;
ALTER TABLE public.openclaw_pull_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read openclaw pull log"
  ON public.openclaw_pull_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
