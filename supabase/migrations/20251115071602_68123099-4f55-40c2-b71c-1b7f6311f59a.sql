-- Add columns to conversations table for better chat interface
ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS unread_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_message_preview text,
ADD COLUMN IF NOT EXISTS pinned boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id);

-- Create quick_reply_templates table
CREATE TABLE IF NOT EXISTS public.quick_reply_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL,
  shortcut text,
  category text DEFAULT 'general',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS for quick_reply_templates
ALTER TABLE public.quick_reply_templates ENABLE ROW LEVEL SECURITY;

-- RLS policies for quick_reply_templates
CREATE POLICY "Users can view their company templates"
  ON public.quick_reply_templates
  FOR SELECT
  USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can insert templates for their company"
  ON public.quick_reply_templates
  FOR INSERT
  WITH CHECK (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can update their company templates"
  ON public.quick_reply_templates
  FOR UPDATE
  USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can delete their company templates"
  ON public.quick_reply_templates
  FOR DELETE
  USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_conversations_unread ON public.conversations(unread_count) WHERE unread_count > 0;
CREATE INDEX IF NOT EXISTS idx_conversations_pinned ON public.conversations(pinned) WHERE pinned = true;
CREATE INDEX IF NOT EXISTS idx_conversations_archived ON public.conversations(archived);
CREATE INDEX IF NOT EXISTS idx_quick_reply_templates_company ON public.quick_reply_templates(company_id);