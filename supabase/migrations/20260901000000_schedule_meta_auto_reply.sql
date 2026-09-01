-- Schedule meta-auto-reply to drain inbound_events for FB/IG DMs + comments.
-- Runs every 30 seconds (matches the old openclaw-pending-trigger cadence).
-- The worker only claims events for companies with harness_mode='on' and replies via
-- the harness — safe to run frequently.

SELECT cron.unschedule('meta-auto-reply-30s')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meta-auto-reply-30s');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'meta-auto-reply-30s',
      '30 seconds',
      $$
      SELECT net.http_post(
        url := 'https://dzheddvoiauevcayifev.supabase.co/functions/v1/meta-auto-reply',
        headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6aGVkZHZvaWF1ZXZjYXlpZmV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEyODM2NjYsImV4cCI6MjA3Njg1OTY2Nn0.M-Q8-ivLtTgA4VGtBiHyojRc-jSM0fEQ930jW3cwHZI"}'::jsonb,
        body := '{}'::jsonb
      );
      $$
    );
  END IF;
END $$;
