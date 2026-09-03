ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS agent_takeover_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS agent_last_heartbeat timestamptz;

UPDATE public.companies SET agent_takeover_enabled = true
  WHERE id = '3408d643-8e9c-4c46-b684-4960fba1e0e9';

ALTER TABLE public.companies DROP COLUMN IF EXISTS openclaw_takeover_enabled;
ALTER TABLE public.companies DROP COLUMN IF EXISTS openclaw_last_heartbeat;