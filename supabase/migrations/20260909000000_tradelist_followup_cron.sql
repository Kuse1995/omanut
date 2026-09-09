-- TradeList 2-hour follow-up: pg_cron pings tradelist-followup every 15 min.
-- The function itself filters conversations whose last activity is 100-160 min
-- old and sends ONE follow-up per conversation (marker-deduped).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'tradelist-followup-15min',
  '*/15 * * * *',
  $$ select net.http_post(
       url := 'https://dzheddvoiauevcayifev.supabase.co/functions/v1/tradelist-followup',
       headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6aGVkZHZvaWF1ZXZjYXlpZmV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEyODM2NjYsImV4cCI6MjA3Njg1OTY2Nn0.M-Q8-ivLtTgA4VGtBiHyojRc-jSM0fEQ930jW3cwHZI'),
       body := '{}'::jsonb
     ) $$
);
