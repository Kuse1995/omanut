-- Drop existing storage policies
DROP POLICY IF EXISTS "Users can upload media for their company" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their company media" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their company media" ON storage.objects;
DROP POLICY IF EXISTS "Public can view company media" ON storage.objects;

-- Create a security definer function to check company access
CREATE OR REPLACE FUNCTION public.user_has_company_access(company_uuid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users 
    WHERE users.id = auth.uid() 
    AND users.company_id = company_uuid
  );
$$;

-- Simpler policies using the function
CREATE POLICY "Users can upload media for their company"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'company-media' 
  AND public.user_has_company_access((storage.foldername(name))[1]::uuid)
);

CREATE POLICY "Users can view their company media"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'company-media'
  AND public.user_has_company_access((storage.foldername(name))[1]::uuid)
);

CREATE POLICY "Users can delete their company media"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'company-media'
  AND public.user_has_company_access((storage.foldername(name))[1]::uuid)
);

CREATE POLICY "Public can view company media"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'company-media');