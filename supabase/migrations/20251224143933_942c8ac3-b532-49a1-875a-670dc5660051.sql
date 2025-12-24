-- Add Meta WhatsApp fields to companies table
ALTER TABLE public.companies 
ADD COLUMN IF NOT EXISTS meta_phone_number_id text,
ADD COLUMN IF NOT EXISTS meta_business_account_id text;

-- Create whatsapp_messages table for Meta-based WhatsApp messaging
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  whatsapp_message_id text,
  customer_phone text NOT NULL,
  customer_name text,
  message_type text DEFAULT 'text',
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  content text,
  media_url text,
  media_type text,
  status text DEFAULT 'received',
  error_code text,
  error_message text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_company_id ON public.whatsapp_messages(company_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conversation_id ON public.whatsapp_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_customer_phone ON public.whatsapp_messages(customer_phone);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_whatsapp_message_id ON public.whatsapp_messages(whatsapp_message_id);

-- Enable RLS
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their company whatsapp messages"
  ON public.whatsapp_messages FOR SELECT
  USING (company_id IN (SELECT users.company_id FROM users WHERE users.id = auth.uid()));

CREATE POLICY "Admins can view all whatsapp messages"
  ON public.whatsapp_messages FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "System can insert whatsapp messages"
  ON public.whatsapp_messages FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update whatsapp messages"
  ON public.whatsapp_messages FOR UPDATE
  USING (true);

-- Add meta_phone_number_id index for company lookup
CREATE INDEX IF NOT EXISTS idx_companies_meta_phone_number_id ON public.companies(meta_phone_number_id);