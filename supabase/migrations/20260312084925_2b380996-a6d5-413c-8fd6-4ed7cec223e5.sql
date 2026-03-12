
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to payment_products
ALTER TABLE public.payment_products ADD COLUMN IF NOT EXISTS embedding vector(768);

-- Create similarity search function
CREATE OR REPLACE FUNCTION public.match_products(
  query_embedding vector(768),
  match_company_id uuid,
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  price numeric,
  currency text,
  category text,
  product_type text,
  delivery_type text,
  selar_link text,
  similarity float
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT
    p.id,
    p.name,
    p.description,
    p.price,
    p.currency,
    p.category,
    p.product_type,
    p.delivery_type,
    p.selar_link,
    1 - (p.embedding <=> query_embedding) AS similarity
  FROM public.payment_products p
  WHERE p.company_id = match_company_id
    AND p.is_active = true
    AND p.embedding IS NOT NULL
    AND 1 - (p.embedding <=> query_embedding) > match_threshold
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
$$;
