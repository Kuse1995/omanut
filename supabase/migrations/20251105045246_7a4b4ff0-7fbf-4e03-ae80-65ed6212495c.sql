-- Add RLS policies for company-documents bucket to allow authenticated users to upload
CREATE POLICY "Authenticated users can upload to company-documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'company-documents');

CREATE POLICY "Public can view company-documents"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'company-documents');

CREATE POLICY "Authenticated users can update their uploads in company-documents"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'company-documents');

CREATE POLICY "Authenticated users can delete their uploads in company-documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'company-documents');