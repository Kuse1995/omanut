-- The owner-visible inbox metadata was only half maintained.
--
-- conversations.last_message_at is set by a trigger on public.messages, but
-- last_message_preview and unread_count were never maintained for most channels.
-- Result: the boss's inbox summaries read "No preview", every unread badge showed
-- 0, and lead snapshots that filter on message text silently dropped real leads.
--
-- This keeps all three in step from either source:
--   * a row in public.messages (the WhatsApp/Messenger path inserts these), and
--   * conversations.transcript (the path used when no message rows are written).

CREATE OR REPLACE FUNCTION public.update_conversation_last_message_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.conversations
     SET last_message_at = NEW.created_at,
         last_message_preview = left(regexp_replace(COALESCE(NEW.content, ''), '\s+', ' ', 'g'), 200),
         unread_count = CASE
           WHEN COALESCE(NEW.role, '') = 'user' THEN COALESCE(unread_count, 0) + 1
           ELSE COALESCE(unread_count, 0)
         END,
         updated_at = now()
   WHERE id = NEW.conversation_id
     AND (last_message_at IS NULL OR last_message_at <= NEW.created_at);
  RETURN NEW;
END;
$$;

-- Transcript-only channels: keep the preview and timestamp fresh when it changes.
CREATE OR REPLACE FUNCTION public.sync_conversation_from_transcript()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tail text;
BEGIN
  IF NEW.transcript IS NOT NULL AND NEW.transcript IS DISTINCT FROM OLD.transcript THEN
    v_tail := btrim(regexp_replace(NEW.transcript, '\s+', ' ', 'g'));
    NEW.last_message_preview := right(v_tail, 200);
    IF NEW.last_message_at IS NULL THEN
      NEW.last_message_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_conversation_from_transcript ON public.conversations;
CREATE TRIGGER trg_sync_conversation_from_transcript
  BEFORE UPDATE OF transcript ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.sync_conversation_from_transcript();

-- One-off backfill so the inbox is readable immediately.
UPDATE public.conversations
   SET last_message_preview = right(btrim(regexp_replace(transcript, '\s+', ' ', 'g')), 200),
       last_message_at = COALESCE(last_message_at, updated_at, created_at)
 WHERE last_message_preview IS NULL
   AND transcript IS NOT NULL
   AND btrim(transcript) <> '';
