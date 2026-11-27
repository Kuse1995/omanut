-- ============================================================================
-- RUN ONLY AT FINAL STAGE 2B CUTOVER (after DB import + Storage sync + Secrets)!
-- ============================================================================
-- Do NOT execute on staging while dzheddvoiauevcayifev is still handling live traffic.
-- Before executing, replace <NEW_ANON_OR_PUBLISHABLE_KEY> and <CRON_SECRET> with rwjeuiwaiflidurgqpks's values.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 1. Remove any stale cron jobs copied over from old project dumps
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT jobid FROM cron.job LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

-- 2. Re-create SQL maintenance cron (no HTTP)
SELECT cron.schedule(
  'openclaw-release-stuck-events',
  '* * * * *',
  $cron$ SELECT public.release_stuck_events(60); $cron$
);

-- 3. Schedule HTTP Edge Function crons against https://rwjeuiwaiflidurgqpks.supabase.co
DO $crons$
DECLARE
  v_base text := 'https://rwjeuiwaiflidurgqpks.supabase.co/functions/v1/';
  v_hdrs jsonb := jsonb_build_object(
    'Content-Type', 'application/json',
    'apikey', '<NEW_ANON_OR_PUBLISHABLE_KEY>',
    'Authorization', 'Bearer <NEW_ANON_OR_PUBLISHABLE_KEY>',
    'X-Cron-Secret', '<CRON_SECRET>'
  );
  v_cron_secret_hdrs jsonb := jsonb_build_object(
    'Content-Type', 'application/json',
    'apikey', '<NEW_ANON_OR_PUBLISHABLE_KEY>',
    'Authorization', 'Bearer <CRON_SECRET>'
  );
BEGIN
  PERFORM cron.schedule('meta-auto-reply-30s', '30 seconds',
    format('SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb);', v_base || 'meta-auto-reply', v_cron_secret_hdrs::text, '{}'));

  PERFORM cron.schedule('poll-video-generation-60s', '* * * * *',
    format('SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb);', v_base || 'poll-video-generation', v_hdrs::text, '{}'));

  PERFORM cron.schedule('cron-publisher-1min', '* * * * *',
    format('SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb);', v_base || 'cron-publisher', v_hdrs::text, '{}'));

  PERFORM cron.schedule('tradelist-followup-15min', '*/15 * * * *',
    format('SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb);', v_base || 'tradelist-followup', v_hdrs::text, '{}'));

  PERFORM cron.schedule('engagement-watchdog-5min', '*/5 * * * *',
    format('SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb);', v_base || 'engagement-watchdog', v_hdrs::text, '{}'));

  PERFORM cron.schedule('bms-auto-sync-cron-15min', '*/15 * * * *',
    format('SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb);', v_base || 'bms-auto-sync-cron', v_hdrs::text, '{}'));

  PERFORM cron.schedule('marketer-monday-kickoff', '0 6 * * 1',
    format('SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb);', v_base || 'marketer-proactive-cron', v_hdrs::text, '{"job_type":"monday_kickoff"}'));

  PERFORM cron.schedule('marketer-friday-digest', '0 14 * * 5',
    format('SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb);', v_base || 'marketer-proactive-cron', v_hdrs::text, '{"job_type":"friday_digest"}'));

  PERFORM cron.schedule('marketer-autopilot-veto-30m', '*/30 * * * *',
    format('SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb);', v_base || 'marketer-proactive-cron', v_hdrs::text, '{"job_type":"autopilot_veto_check"}'));

  PERFORM cron.schedule('marketer-vault-renewal-daily', '0 7 * * *',
    format('SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb);', v_base || 'marketer-proactive-cron', v_hdrs::text, '{"job_type":"vault_and_renewal_check"}'));

  PERFORM cron.schedule('boss-media-watchdog-5min', '*/5 * * * *',
    format('SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb);', v_base || 'boss-media-watchdog', v_hdrs::text, '{}'));

  PERFORM cron.schedule('pending-promise-watchdog-5min', '*/5 * * * *',
    format('SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb);', v_base || 'pending-promise-watchdog', v_hdrs::text, '{}'));

  PERFORM cron.schedule('check-unanswered-10min', '*/10 * * * *',
    format('SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb);', v_base || 'check-unanswered', v_hdrs::text, '{}'));

  PERFORM cron.schedule('sla-escalation-10min', '*/10 * * * *',
    format('SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb);', v_base || 'sla-escalation', v_hdrs::text, '{}'));

  PERFORM cron.schedule('csat-followup-hourly', '30 * * * *',
    format('SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb);', v_base || 'csat-followup', v_hdrs::text, '{}'));
END $crons$;

SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobname;
