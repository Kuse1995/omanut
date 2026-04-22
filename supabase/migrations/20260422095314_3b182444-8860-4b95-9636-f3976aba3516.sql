-- 1. Add tracking columns to conversations
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_promise_fulfillment_at timestamptz,
  ADD COLUMN IF NOT EXISTS promise_fulfillment_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS promise_fulfillment_window_start timestamptz;

-- 2. Pause the runaway ANZ conversation
UPDATE public.conversations
SET is_paused_for_human = true
WHERE id = '67b90349-55e9-42c6-9f41-00d8fa601afa';

-- 3. Fix ANZ broken model
UPDATE public.company_ai_overrides
SET primary_model = 'google/gemini-2.5-flash'
WHERE primary_model = 'zai/glm-4.7';

-- 4. Unschedule the watchdog cron (will be re-scheduled after fix is deployed)
DO $$
DECLARE
  job_id bigint;
BEGIN
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'pending-promise-watchdog-every-minute';
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- cron extension may not be present or job name different; ignore
  NULL;
END $$;