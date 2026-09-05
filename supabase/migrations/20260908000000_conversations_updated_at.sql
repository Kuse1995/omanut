-- The thread rail (agent-console list_threads) orders conversations by
-- updated_at, but the column never existed on this table - PostgREST returned
-- a 400 on every list_threads call, so the rail always showed
-- 'No conversations yet'. Add it and backfill from real activity.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

UPDATE public.conversations
SET updated_at = COALESCE(last_message_at, created_at, now());
