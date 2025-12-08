-- Drop existing insecure policies for digital-products bucket
DROP POLICY IF EXISTS "Users can upload digital products for their company" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their company digital products" ON storage.objects;

-- Create secure INSERT policy with company ownership verification
CREATE POLICY "Digital products: authenticated insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'digital-products' 
  AND public.user_has_company_access((storage.foldername(name))[1]::uuid)
);

-- Create secure SELECT policy with company ownership verification
CREATE POLICY "Digital products: authenticated select" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'digital-products' 
  AND public.user_has_company_access((storage.foldername(name))[1]::uuid)
);

-- Create secure UPDATE policy with company ownership verification
CREATE POLICY "Digital products: authenticated update" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'digital-products' 
  AND public.user_has_company_access((storage.foldername(name))[1]::uuid)
);

-- Create secure DELETE policy with company ownership verification
CREATE POLICY "Digital products: authenticated delete" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'digital-products' 
  AND public.user_has_company_access((storage.foldername(name))[1]::uuid)
);

-- Create admin full access policy for digital-products
CREATE POLICY "Digital products: admin full access" ON storage.objects
FOR ALL TO authenticated
USING (
  bucket_id = 'digital-products' 
  AND public.has_role(auth.uid(), 'admin')
)
WITH CHECK (
  bucket_id = 'digital-products' 
  AND public.has_role(auth.uid(), 'admin')
);