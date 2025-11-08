-- Create media delivery status tracking table
CREATE TABLE IF NOT EXISTS public.media_delivery_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  customer_phone TEXT NOT NULL,
  media_url TEXT NOT NULL,
  twilio_message_sid TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  error_code TEXT,
  error_message TEXT,
  sent_at TIMESTAMPTZ DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add index for faster lookups
CREATE INDEX idx_media_delivery_status_company ON public.media_delivery_status(company_id);
CREATE INDEX idx_media_delivery_status_conversation ON public.media_delivery_status(conversation_id);
CREATE INDEX idx_media_delivery_status_twilio_sid ON public.media_delivery_status(twilio_message_sid);

-- Enable RLS
ALTER TABLE public.media_delivery_status ENABLE ROW LEVEL SECURITY;

-- RLS policies - only company users can view their media delivery status
CREATE POLICY "Users can view their company's media delivery status"
  ON public.media_delivery_status
  FOR SELECT
  USING (user_has_company_access(company_id));

-- Add trigger for updated_at
CREATE TRIGGER update_media_delivery_status_updated_at
  BEFORE UPDATE ON public.media_delivery_status
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();