-- Sync two WhatsApp Cloud ID columns on companies that existed on Lovable Cloud prior to standalone cutover
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS meta_phone_number_id text,
  ADD COLUMN IF NOT EXISTS meta_business_account_id text;
