-- Add admin bypass policy for company-media storage bucket
-- This allows admins to upload to any company folder

-- Admin can insert files to any company folder
CREATE POLICY "Admins can insert any company media"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'company-media' 
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);

-- Admin can select files from any company folder
CREATE POLICY "Admins can select any company media"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'company-media' 
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);

-- Admin can update files in any company folder
CREATE POLICY "Admins can update any company media"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'company-media' 
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);

-- Admin can delete files from any company folder
CREATE POLICY "Admins can delete any company media"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'company-media' 
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);