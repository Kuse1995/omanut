-- Drop existing storage policies for company-media bucket
DROP POLICY IF EXISTS "Users can upload media for their company" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their company media" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their company media" ON storage.objects;
DROP POLICY IF EXISTS "Public can view company media" ON storage.objects;

-- Simpler storage policies using direct user-company relationship

-- Allow authenticated users to upload media for their company
CREATE POLICY "Users can upload media for their company"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'company-media' 
  AND EXISTS (
    SELECT 1 FROM public.users 
    WHERE users.id = auth.uid() 
    AND users.company_id::text = (storage.foldername(name))[1]
  )
);

-- Allow authenticated users to view media from their company
CREATE POLICY "Users can view their company media"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'company-media'
  AND EXISTS (
    SELECT 1 FROM public.users 
    WHERE users.id = auth.uid() 
    AND users.company_id::text = (storage.foldername(name))[1]
  )
);

-- Allow authenticated users to delete media from their company
CREATE POLICY "Users can delete their company media"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'company-media'
  AND EXISTS (
    SELECT 1 FROM public.users 
    WHERE users.id = auth.uid() 
    AND users.company_id::text = (storage.foldername(name))[1]
  )
);

-- Allow public read access since bucket is public
CREATE POLICY "Public can view company media"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'company-media');