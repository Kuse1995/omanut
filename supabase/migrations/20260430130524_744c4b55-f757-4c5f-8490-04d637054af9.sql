-- Enum for OpenClaw operating mode
DO $$ BEGIN
  CREATE TYPE public.openclaw_mode_t AS ENUM ('off','assist','primary');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Companies columns
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS openclaw_mode public.openclaw_mode_t NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS openclaw_owns jsonb NOT NULL DEFAULT '{"whatsapp":false,"meta_dm":false,"comments":false,"content":false,"bms":false,"handoff":false}'::jsonb,
  ADD COLUMN IF NOT EXISTS openclaw_last_heartbeat timestamptz,
  ADD COLUMN IF NOT EXISTS openclaw_webhook_url text;

-- Backfill: if legacy takeover was enabled, treat as assist
UPDATE public.companies
SET openclaw_mode = 'assist'
WHERE openclaw_mode = 'off'
  AND COALESCE((to_jsonb(companies)->>'openclaw_takeover_enabled')::boolean, false) = true;

-- Events table
CREATE TABLE IF NOT EXISTS public.openclaw_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id uuid,
  channel text NOT NULL,
  event_type text NOT NULL,
  skill text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  dispatch_status text,
  dispatch_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  answered_by text,
  answered_action text
);

CREATE INDEX IF NOT EXISTS idx_openclaw_events_company_status_created
  ON public.openclaw_events(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_openclaw_events_conversation
  ON public.openclaw_events(conversation_id);

ALTER TABLE public.openclaw_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company members can view openclaw events" ON public.openclaw_events;
CREATE POLICY "Company members can view openclaw events"
  ON public.openclaw_events FOR SELECT
  TO authenticated
  USING (public.user_has_company_access_v2(company_id) OR public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "Admins can manage openclaw events" ON public.openclaw_events;
CREATE POLICY "Admins can manage openclaw events"
  ON public.openclaw_events FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));