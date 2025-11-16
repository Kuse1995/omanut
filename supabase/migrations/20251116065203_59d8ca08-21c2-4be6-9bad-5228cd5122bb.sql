-- Add takeover_number field to companies table
ALTER TABLE public.companies
ADD COLUMN takeover_number text;

COMMENT ON COLUMN public.companies.takeover_number IS 'WhatsApp number that receives client messages during takeover and can send replies on behalf of the business';