ALTER TABLE public.payment_products
  ADD COLUMN IF NOT EXISTS media_id uuid REFERENCES public.company_media(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bms_product_id text,
  ADD COLUMN IF NOT EXISTS sku text;
CREATE INDEX IF NOT EXISTS idx_payment_products_media_id ON public.payment_products(media_id);