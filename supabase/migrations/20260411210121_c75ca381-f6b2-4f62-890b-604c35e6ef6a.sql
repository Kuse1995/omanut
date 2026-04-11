-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Function to find unanswered conversations
CREATE OR REPLACE FUNCTION public.find_unanswered_conversations(cutoff_time timestamptz)
RETURNS TABLE(id uuid, company_id uuid, phone text, customer_name text, last_message_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.company_id, c.phone, c.customer_name, c.last_message_at
  FROM public.conversations c
  WHERE c.status = 'active'
    AND (c.human_takeover IS NULL OR c.human_takeover = false)
    AND c.last_message_at < cutoff_time
    AND c.last_message_at > (now() - interval '30 minutes')
    AND EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.conversation_id = c.id
        AND m.role = 'user'
        AND m.created_at = (
          SELECT MAX(m2.created_at) FROM public.messages m2
          WHERE m2.conversation_id = c.id
        )
    )
  LIMIT 50;
$$;