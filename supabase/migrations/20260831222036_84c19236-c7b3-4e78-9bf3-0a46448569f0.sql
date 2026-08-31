-- Enable omanut-harness for ALL companies (harness_mode = 'on').
-- Forward-only, idempotent. Rollback: set harness_mode = 'off'.
UPDATE public.companies
SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"harness_mode":"on"}'::jsonb
WHERE metadata->>'harness_mode' IS DISTINCT FROM 'on';