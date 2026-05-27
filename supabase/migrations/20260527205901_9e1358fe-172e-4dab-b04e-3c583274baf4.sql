CREATE OR REPLACE FUNCTION public.claim_pending_events(
  _company_id uuid,
  _max integer DEFAULT 10,
  _claimed_by text DEFAULT 'openclaw'
)
RETURNS SETOF public.inbound_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.inbound_events ie
     SET status     = 'processing',
         claimed_by = _claimed_by,
         claimed_at = now(),
         picked_at  = COALESCE(ie.picked_at, now())
   WHERE ie.id IN (
     SELECT id
       FROM public.inbound_events
      WHERE (
              status = 'pending'
              OR (
                status = 'processing'
                AND claimed_at IS NOT NULL
                AND claimed_at < now() - interval '2 minutes'
              )
            )
        AND next_attempt_at <= now()
        AND created_at >= now() - interval '1 hour'
        AND (_company_id IS NULL OR company_id = _company_id)
      ORDER BY created_at ASC
      LIMIT GREATEST(1, LEAST(_max, 50))
      FOR UPDATE SKIP LOCKED
   )
   RETURNING ie.*;
END;
$function$;