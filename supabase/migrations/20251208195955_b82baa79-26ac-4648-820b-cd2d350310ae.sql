-- Add product type and digital delivery columns to payment_products
ALTER TABLE public.payment_products 
ADD COLUMN IF NOT EXISTS product_type text DEFAULT 'service' CHECK (product_type IN ('physical', 'digital', 'service')),
ADD COLUMN IF NOT EXISTS delivery_type text DEFAULT 'manual' CHECK (delivery_type IN ('manual', 'auto_download', 'email_delivery')),
ADD COLUMN IF NOT EXISTS digital_file_path text,
ADD COLUMN IF NOT EXISTS download_url text,
ADD COLUMN IF NOT EXISTS download_limit integer DEFAULT 3,
ADD COLUMN IF NOT EXISTS download_expiry_hours integer DEFAULT 48;

-- Create digital product deliveries table
CREATE TABLE IF NOT EXISTS public.digital_product_deliveries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  transaction_id uuid REFERENCES public.payment_transactions(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.payment_products(id) ON DELETE SET NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_phone text NOT NULL,
  customer_email text,
  delivery_method text DEFAULT 'whatsapp' CHECK (delivery_method IN ('whatsapp', 'email', 'both')),
  download_url text,
  download_count integer DEFAULT 0,
  max_downloads integer DEFAULT 3,
  expires_at timestamp with time zone,
  delivered_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.digital_product_deliveries ENABLE ROW LEVEL SECURITY;

-- RLS policies for digital_product_deliveries
CREATE POLICY "Users can view their company deliveries" 
ON public.digital_product_deliveries 
FOR SELECT 
USING (company_id IN (SELECT users.company_id FROM users WHERE users.id = auth.uid()));

CREATE POLICY "Users can insert deliveries for their company" 
ON public.digital_product_deliveries 
FOR INSERT 
WITH CHECK (company_id IN (SELECT users.company_id FROM users WHERE users.id = auth.uid()));

CREATE POLICY "Users can update their company deliveries" 
ON public.digital_product_deliveries 
FOR UPDATE 
USING (company_id IN (SELECT users.company_id FROM users WHERE users.id = auth.uid()));

CREATE POLICY "Admins can manage all deliveries" 
ON public.digital_product_deliveries 
FOR ALL 
USING (has_role(auth.uid(), 'admin'));

-- Create digital-products storage bucket
INSERT INTO storage.buckets (id, name, public) 
VALUES ('digital-products', 'digital-products', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for digital-products bucket
CREATE POLICY "Users can upload digital products for their company"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'digital-products' 
  AND auth.uid() IS NOT NULL
);

CREATE POLICY "Users can view their company digital products"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'digital-products' 
  AND auth.uid() IS NOT NULL
);

CREATE POLICY "Users can delete their company digital products"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'digital-products' 
  AND auth.uid() IS NOT NULL
);