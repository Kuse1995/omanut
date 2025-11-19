-- Add WhatsApp Flow ID columns to companies table for storing Twilio Flow configurations
ALTER TABLE public.companies 
ADD COLUMN whatsapp_reservation_flow_id TEXT,
ADD COLUMN whatsapp_payment_flow_id TEXT;

-- Add comment explaining the columns
COMMENT ON COLUMN public.companies.whatsapp_reservation_flow_id IS 'Twilio WhatsApp Flow ID for reservation forms';
COMMENT ON COLUMN public.companies.whatsapp_payment_flow_id IS 'Twilio WhatsApp Flow ID for payment information forms';