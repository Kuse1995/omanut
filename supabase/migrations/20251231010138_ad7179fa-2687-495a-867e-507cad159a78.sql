-- Create message_reply_drafts table for AI-generated reply workflow
CREATE TABLE public.message_reply_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  
  source_type text NOT NULL CHECK (source_type IN ('facebook_message', 'facebook_comment')),
  source_id uuid NOT NULL,
  
  ai_reply text NOT NULL,
  prompt_context jsonb DEFAULT '{}'::jsonb,
  
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'sent', 'rejected')),
  
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamp with time zone,
  sent_at timestamp with time zone,
  rejected_at timestamp with time zone,
  rejection_reason text,
  
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.message_reply_drafts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Read: company members can read reply drafts
CREATE POLICY "Company members can read reply drafts"
ON public.message_reply_drafts
FOR SELECT
USING (user_has_company_access_v2(company_id));

-- Insert: system/contributors+ can create drafts
CREATE POLICY "System can create drafts"
ON public.message_reply_drafts
FOR INSERT
WITH CHECK (true);

-- Update: managers+ can approve/reject/update replies
CREATE POLICY "Managers can update reply drafts"
ON public.message_reply_drafts
FOR UPDATE
USING (has_company_role(company_id, 'manager'::company_role));

-- Delete: owners only
CREATE POLICY "Owners can delete reply drafts"
ON public.message_reply_drafts
FOR DELETE
USING (has_company_role(company_id, 'owner'::company_role));

-- Platform admins full access
CREATE POLICY "Platform admins full access to reply drafts"
ON public.message_reply_drafts
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create index for efficient lookups
CREATE INDEX idx_message_reply_drafts_company_id ON public.message_reply_drafts(company_id);
CREATE INDEX idx_message_reply_drafts_source ON public.message_reply_drafts(source_type, source_id);
CREATE INDEX idx_message_reply_drafts_status ON public.message_reply_drafts(status);

-- Add updated_at trigger
CREATE TRIGGER update_message_reply_drafts_updated_at
  BEFORE UPDATE ON public.message_reply_drafts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();