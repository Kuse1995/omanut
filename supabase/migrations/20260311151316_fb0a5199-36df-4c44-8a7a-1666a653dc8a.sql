ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS external_catalog_url text,
  ADD COLUMN IF NOT EXISTS external_catalog_key text,
  ADD COLUMN IF NOT EXISTS external_catalog_table text DEFAULT 'ebooks';