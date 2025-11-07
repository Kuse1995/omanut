-- Drop ALL existing storage policies for company-media to start fresh
DROP POLICY IF EXISTS "Users can upload media for their company" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their company media" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their company media" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their company media" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their company media" ON storage.objects;
DROP POLICY IF EXISTS "Public can view company media" ON storage.objects;
DROP POLICY IF EXISTS "Media files are publicly accessible" ON storage.objects;

-- Create clean, single-purpose policies for company-media bucket
CREATE POLICY "Company media: authenticated insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'company-media' 
  AND public.user_has_company_access((storage.foldername(name))[1]::uuid)
);

CREATE POLICY "Company media: authenticated select"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'company-media'
  AND public.user_has_company_access((storage.foldername(name))[1]::uuid)
);

CREATE POLICY "Company media: public select"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'company-media');

CREATE POLICY "Company media: authenticated update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'company-media'
  AND public.user_has_company_access((storage.foldername(name))[1]::uuid)
);

CREATE POLICY "Company media: authenticated delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'company-media'
  AND public.user_has_company_access((storage.foldername(name))[1]::uuid)
);