-- Enable omanut-harness for ALL companies (harness_mode = 'on').
-- Forward-only. After this, every company's LLM decisions route to the external
-- omanut-harness (DeepSeek on the farm) with in-house fallback on any error.
-- Rollback: set harness_mode = 'off' per company.
-- Safe to re-run (idempotent).

UPDATE public.companies
SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"harness_mode":"on"}'::jsonb
WHERE metadata->>'harness_mode' IS DISTINCT FROM 'on';
