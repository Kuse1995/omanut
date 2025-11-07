-- Create enum type for media categories
CREATE TYPE media_category AS ENUM (
  'menu',
  'interior', 
  'exterior',
  'logo',
  'products',
  'promotional',
  'staff',
  'events',
  'facilities',
  'other'
);

-- Add category column to company_media table
ALTER TABLE public.company_media 
ADD COLUMN category media_category NOT NULL DEFAULT 'other';

-- Add index for faster category-based queries
CREATE INDEX idx_company_media_category ON public.company_media(company_id, category);

-- Update existing records to have 'other' category (already set by default)
COMMENT ON COLUMN public.company_media.category IS 'Category of media for organization and AI matching';