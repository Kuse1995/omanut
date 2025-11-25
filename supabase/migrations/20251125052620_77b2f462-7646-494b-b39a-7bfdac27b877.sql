-- Add test_mode column to companies table
ALTER TABLE public.companies 
ADD COLUMN test_mode BOOLEAN DEFAULT true;

-- Add comment explaining the field
COMMENT ON COLUMN public.companies.test_mode IS 'When true, boss notifications are logged but not sent. When false (production mode), notifications are sent to boss_phone.';