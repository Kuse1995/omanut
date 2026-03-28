-- Add last_message_at column
ALTER TABLE public.conversations ADD COLUMN last_message_at timestamptz DEFAULT now();

-- Backfill from existing messages
UPDATE public.conversations c
SET last_message_at = COALESCE(
  (SELECT MAX(m.created_at) FROM public.messages m WHERE m.conversation_id = c.id),
  c.started_at
);

-- Create trigger function
CREATE OR REPLACE FUNCTION public.update_conversation_last_message_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.conversations
  SET last_message_at = NEW.created_at
  WHERE id = NEW.conversation_id
    AND (last_message_at IS NULL OR last_message_at < NEW.created_at);
  RETURN NEW;
END;
$$;

-- Create trigger
CREATE TRIGGER trg_update_last_message_at
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.update_conversation_last_message_at();