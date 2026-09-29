-- 20260910000500_is_live_unsandbox_and_replay.sql
--
-- Incident: "why arent you replying to comments on the zamcash posts?"
--
-- Root cause (not the AI, not the webhook):
--   send-facebook-comment-reply, send-meta-dm, send-whatsapp-cloud,
--   send-whatsapp-message and meta-ads-launch all pass through
--   _shared/is-live-gate.ts, which refuses to call a real provider when
--   companies.is_live is not true: it writes the intended message to
--   test_outbound_log and returns { success: true, sandboxed: true }.
--   companies.is_live is NOT NULL DEFAULT false and was backfilled exactly once
--   (20260525145808: "SET is_live = true WHERE created_at < now()").
--   ZamCash Loans was created by 20260910000000 after that backfill, so every
--   comment reply, DM and WhatsApp message it produced was swallowed by the
--   sandbox, while meta-auto-reply discarded the result and marked the inbound
--   events "sent". The comments were received, replies were generated, and
--   nothing ever reached Facebook.
--
-- This migration (1) takes real, traffic-receiving companies out of the
-- sandbox and (2) re-queues the comments that were answered into the void, but
-- only for companies that genuinely produced sandboxed comment-reply attempts,
-- so a reply that did go out is never posted twice.

-- 1. Un-sandbox companies the platform is actively receiving traffic for.
--    Companies with no inbound traffic (demo/test shells) stay sandboxed.
UPDATE public.companies c
   SET is_live = true
 WHERE c.is_live IS NOT TRUE
   AND EXISTS (
     SELECT 1 FROM public.inbound_events e WHERE e.company_id = c.id
   );

-- ZamCash Loans must be live regardless of traffic (its posts are published).
UPDATE public.companies SET is_live = true
 WHERE id = '10873fee-3fea-4238-b3b5-6d74e360f4b0';

-- 2a. Replay the comment events that were "sent" into the sandbox.
--     Evidence-gated: the company must have sandboxed fb_comment_reply rows on
--     record. One event per comment is replayed (Meta redelivers webhooks, so a
--     single comment can carry several events); the losers are parked in 2b.
--     Sandboxed DMs are deliberately left alone rather than messaging people
--     again weeks later.
WITH replayable AS (
  SELECT DISTINCT ON (e.payload->>'comment_id') e.id
    FROM public.inbound_events e
   WHERE e.channel = 'public_comment'
     AND e.status = 'sent'
     AND e.payload->>'comment_id' IS NOT NULL
     AND e.created_at > now() - interval '60 days'
     AND EXISTS (
       SELECT 1 FROM public.test_outbound_log t
        WHERE t.company_id = e.company_id
          AND t.channel = 'fb_comment_reply'
          AND t.created_at > now() - interval '60 days'
     )
   ORDER BY e.payload->>'comment_id', e.created_at ASC
)
UPDATE public.inbound_events e
   SET status = 'pending',
       claimed_by = NULL,
       claimed_at = NULL,
       attempts = 0,
       last_error = 'replayed: was sandboxed while company_not_live',
       next_attempt_at = now()
 WHERE e.id IN (SELECT id FROM replayable);

-- 2b. Any further "sent" event for the same comment is parked so the duplicate
--     guard in meta-auto-reply cannot post a second reply.
UPDATE public.inbound_events e
   SET status = 'skipped',
       claimed_by = NULL,
       claimed_at = NULL,
       attempts = 0,
       last_error = 'skipped: duplicate comment event during sandbox replay',
       next_attempt_at = now()
 WHERE e.channel = 'public_comment'
   AND e.status = 'sent'
   AND e.payload->>'comment_id' IS NOT NULL
   AND e.created_at > now() - interval '60 days'
   AND EXISTS (
     SELECT 1 FROM public.test_outbound_log t
      WHERE t.company_id = e.company_id
        AND t.channel = 'fb_comment_reply'
        AND t.created_at > now() - interval '60 days'
   );

-- 3. Surface the state of the fleet in the migration log.
DO $$
DECLARE
  r record;
  v_live int := 0;
  v_sandboxed int := 0;
BEGIN
  FOR r IN SELECT id, name, is_live FROM public.companies ORDER BY is_live, name LOOP
    IF r.is_live THEN
      v_live := v_live + 1;
    ELSE
      v_sandboxed := v_sandboxed + 1;
      RAISE NOTICE '[is-live-audit] SANDBOXED company % (%) - outbound suppressed', r.name, r.id;
    END IF;
  END LOOP;
  RAISE NOTICE '[is-live-audit] live=% sandboxed=%', v_live, v_sandboxed;
END $$;
