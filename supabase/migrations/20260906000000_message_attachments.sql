-- Persist chat attachments (ChatGPT-style: media stays visible on the message)
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS attachments jsonb;
