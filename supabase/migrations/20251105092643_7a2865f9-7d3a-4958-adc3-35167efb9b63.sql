-- Add boss phone number to companies table
ALTER TABLE public.companies 
ADD COLUMN boss_phone text;

-- Create a table to track boss conversations
CREATE TABLE public.boss_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  message_from text NOT NULL,
  message_content text NOT NULL,
  response text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on boss_conversations
ALTER TABLE public.boss_conversations ENABLE ROW LEVEL SECURITY;

-- RLS policies for boss_conversations
CREATE POLICY "Users can view their company boss conversations"
ON public.boss_conversations
FOR SELECT
USING (company_id IN (
  SELECT company_id FROM public.users WHERE id = auth.uid()
));

CREATE POLICY "System can insert boss conversations"
ON public.boss_conversations
FOR INSERT
WITH CHECK (true);