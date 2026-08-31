-- Enable omanut-harness PILOT for the OmanutBMS company (boss's own line only).
-- Forward-only. This is the opt-in switch documented in AGENTS.md §8c and
-- docs/HARNESS-INTEGRATION.md. All other companies + all other phones remain
-- on the in-house pipeline. Rollback: set harness_mode = 'off' (metadata ||).
-- Safe to re-run (idempotent update).

UPDATE public.companies
SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"harness_mode":"pilot","harness_pilot_phones":["+260972064502"]}'::jsonb
WHERE id = '3408d643-8e9c-4c46-b684-4960fba1e0e9'
  AND metadata->>'harness_mode' IS DISTINCT FROM 'pilot';