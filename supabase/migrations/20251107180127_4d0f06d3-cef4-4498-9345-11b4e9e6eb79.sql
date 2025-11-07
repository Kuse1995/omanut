-- Add thumbnail_url column to company_media table
ALTER TABLE public.company_media
ADD COLUMN thumbnail_url TEXT;