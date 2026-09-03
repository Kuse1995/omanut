-- Replace the OpenClaw takeover concept with the platform Agent takeover
-- (the harness-powered agent layer). The old OpenClaw integration is retired:
-- code paths were removed in the same release that ships this migration.

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS agent_takeover_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS agent_last_heartbeat timestamptz;

-- Opt in the operator's own company so agent media delivery + boss
-- notifications work immediately (OmanutBMS).
UPDATE public.companies SET agent_takeover_enabled = true
  WHERE id = '3408d643-8e9c-4c46-b684-4960fba1e0e9';

-- Retire the OpenClaw columns (openclaw-webhook tooling was removed; the
-- heartbeat now lives in agent_last_heartbeat).
ALTER TABLE public.companies DROP COLUMN IF EXISTS openclaw_takeover_enabled;
ALTER TABLE public.companies DROP COLUMN IF EXISTS openclaw_last_heartbeat;