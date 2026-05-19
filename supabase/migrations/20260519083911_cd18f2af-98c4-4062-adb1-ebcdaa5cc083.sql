
-- OpenClaw v3: pull-based consumption
-- Adds claim tracking + RPC + stuck-event recovery

ALTER TABLE public.inbound_events
  ADD COLUMN IF NOT EXISTS claimed_by text,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS consumed_by text;

CREATE INDEX IF NOT EXISTS inbound_events_claimed_idx
  ON public.inbound_events (status, claimed_at)
  WHERE status = 'processing';

-- Atomic claim: flip pending → processing if and only if currently pending.
-- Used by Realtime subscribers (and the pull endpoints).
CREATE OR REPLACE FUNCTION public.claim_inbound_event(
  _event_id uuid,
  _claimed_by text DEFAULT 'openclaw'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.inbound_events
     SET status      = 'processing',
         claimed_by  = _claimed_by,
         claimed_at  = now(),
         picked_at   = COALESCE(picked_at, now())
   WHERE id = _event_id
     AND status = 'pending';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

-- Batch claim: used by the long-poll / SSE endpoints to grab up to N events
-- for one consumer atomically. Returns the full rows.
CREATE OR REPLACE FUNCTION public.claim_pending_events(
  _company_id uuid,
  _max int DEFAULT 10,
  _claimed_by text DEFAULT 'openclaw'
)
RETURNS SETOF public.inbound_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.inbound_events ie
     SET status     = 'processing',
         claimed_by = _claimed_by,
         claimed_at = now(),
         picked_at  = COALESCE(ie.picked_at, now())
   WHERE ie.id IN (
     SELECT id FROM public.inbound_events
      WHERE status = 'pending'
        AND next_attempt_at <= now()
        AND (_company_id IS NULL OR company_id = _company_id)
      ORDER BY created_at ASC
      LIMIT GREATEST(1, LEAST(_max, 50))
      FOR UPDATE SKIP LOCKED
   )
   RETURNING ie.*;
END;
$$;

-- Recover stuck 'processing' rows back to 'pending' so the in-house worker
-- (or another consumer) can retry them.
CREATE OR REPLACE FUNCTION public.release_stuck_events(_stuck_seconds int DEFAULT 60)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.inbound_events
     SET status     = 'pending',
         claimed_by = NULL,
         claimed_at = NULL,
         last_error = COALESCE(last_error, '') || ' [released:stuck]'
   WHERE status = 'processing'
     AND claimed_at IS NOT NULL
     AND claimed_at < now() - make_interval(secs => _stuck_seconds);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Run release every minute via the existing pg_cron schedule the worker uses.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('openclaw-release-stuck-events')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'openclaw-release-stuck-events');
    PERFORM cron.schedule(
      'openclaw-release-stuck-events',
      '* * * * *',
      $cron$ SELECT public.release_stuck_events(60); $cron$
    );
  END IF;
END $$;
