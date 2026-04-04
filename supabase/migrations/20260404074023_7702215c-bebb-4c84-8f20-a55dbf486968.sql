-- FIX 1: video_generation_jobs - Drop the overly permissive public policy and replace with company-scoped authenticated policy
DROP POLICY IF EXISTS "Service role full access on video_generation_jobs" ON public.video_generation_jobs;

-- Only authenticated users with company access can view their company's jobs
CREATE POLICY "Company members can view video jobs"
ON public.video_generation_jobs
FOR SELECT
TO authenticated
USING (user_has_company_access_v2(company_id));

-- Only authenticated users with company access can insert jobs for their company
CREATE POLICY "Company members can insert video jobs"
ON public.video_generation_jobs
FOR INSERT
TO authenticated
WITH CHECK (user_has_company_access_v2(company_id));

-- Only authenticated users with company access can update their company's jobs
CREATE POLICY "Company members can update video jobs"
ON public.video_generation_jobs
FOR UPDATE
TO authenticated
USING (user_has_company_access_v2(company_id));

-- Service role access is implicit (bypasses RLS), so no explicit policy needed

-- FIX 2: company-documents storage - Drop overly permissive delete/update policies
DROP POLICY IF EXISTS "Authenticated users can delete their uploads in company-documen" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update their uploads in company-documen" ON storage.objects;

-- Replace with company-scoped policies using folder-based ownership
CREATE POLICY "Company members can delete company-documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'company-documents'
  AND user_has_company_access_v2(((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "Company members can update company-documents"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'company-documents'
  AND user_has_company_access_v2(((storage.foldername(name))[1])::uuid)
);