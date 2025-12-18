-- Create facebook_messages table for Facebook integration
CREATE TABLE public.facebook_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_psid text NOT NULL,
  page_id text NOT NULL,
  message_text text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  is_processed boolean NOT NULL DEFAULT false
);

-- Enable RLS
ALTER TABLE public.facebook_messages ENABLE ROW LEVEL SECURITY;

-- Allow system/service role to insert messages (from webhook)
CREATE POLICY "System can insert facebook messages"
ON public.facebook_messages
FOR INSERT
WITH CHECK (true);

-- Admins can view all facebook messages
CREATE POLICY "Admins can view all facebook messages"
ON public.facebook_messages
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Admins can update facebook messages
CREATE POLICY "Admins can update facebook messages"
ON public.facebook_messages
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));