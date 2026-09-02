-- Schedule poll-video-generation every 60s so video jobs (veo/minimax/seedance)
-- progress autonomously — same pattern as meta-auto-reply-30s. Idempotent.

SELECT cron.unschedule('poll-video-generation-60s')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'poll-video-generation-60s');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'poll-video-generation-60s',
      '60 seconds',
      $$
      SELECT net.http_post(
        url := 'https://dzheddvoiauevcayifev.supabase.co/functions/v1/poll-video-generation',
        headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6aGVkZHZvaWF1ZXZjYXlpZmV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEyODM2NjYsImV4cCI6MjA3Njg1OTY2Nn0.M-Q8-ivLtTgA4VGtBiHyojRc-jSM0fEQ930jW3cwHZI"}'::jsonb,
        body := '{}'::jsonb
      );
      $$
    );
  END IF;
END $$;