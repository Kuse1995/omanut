-- Drop existing storage policies for company-media bucket if they exist
DROP POLICY IF EXISTS "Users can upload media for their company" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their company media" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their company media" ON storage.objects;
DROP POLICY IF EXISTS "Public can view company media" ON storage.objects;

-- Create storage policies for company-media bucket

-- Allow authenticated users to upload media for their company
CREATE POLICY "Users can upload media for their company"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'company-media' 
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.companies 
    WHERE id IN (
      SELECT company_id FROM public.users WHERE id = auth.uid()
    )
  )
);

-- Allow authenticated users to view media from their company
CREATE POLICY "Users can view their company media"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'company-media'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.companies 
    WHERE id IN (
      SELECT company_id FROM public.users WHERE id = auth.uid()
    )
  )
);

-- Allow authenticated users to delete media from their company
CREATE POLICY "Users can delete their company media"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'company-media'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.companies 
    WHERE id IN (
      SELECT company_id FROM public.users WHERE id = auth.uid()
    )
  )
);

-- Allow public read access to company-media since bucket is public
CREATE POLICY "Public can view company media"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'company-media');