SELECT cron.unschedule('openclaw-pending-trigger-30s');
SELECT cron.schedule(
  'openclaw-pending-trigger-30s',
  '30 seconds',
  $$
  SELECT net.http_post(
    url := 'https://dzheddvoiauevcayifev.supabase.co/functions/v1/openclaw-pending-trigger',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6aGVkZHZvaWF1ZXZjYXlpZmV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEyODM2NjYsImV4cCI6MjA3Njg1OTY2Nn0.M-Q8-ivLtTgA4VGtBiHyojRc-jSM0fEQ930jW3cwHZI"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);