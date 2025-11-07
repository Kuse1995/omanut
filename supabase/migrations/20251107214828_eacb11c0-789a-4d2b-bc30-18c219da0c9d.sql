-- Fix 1: Make storage buckets private
UPDATE storage.buckets 
SET public = false 
WHERE id IN ('company-documents', 'company-media', 'payment-proofs');

-- Fix 2: Add RLS policies for storage.objects (company-scoped access)
CREATE POLICY "Users can view their company files"
ON storage.objects
FOR SELECT
USING (
  bucket_id IN ('company-documents', 'company-media', 'payment-proofs')
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM companies 
    WHERE id IN (
      SELECT company_id FROM users WHERE id = auth.uid()
    )
  )
);

CREATE POLICY "Users can upload their company files"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id IN ('company-documents', 'company-media', 'payment-proofs')
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM companies 
    WHERE id IN (
      SELECT company_id FROM users WHERE id = auth.uid()
    )
  )
);

CREATE POLICY "Users can update their company files"
ON storage.objects
FOR UPDATE
USING (
  bucket_id IN ('company-documents', 'company-media', 'payment-proofs')
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM companies 
    WHERE id IN (
      SELECT company_id FROM users WHERE id = auth.uid()
    )
  )
);

CREATE POLICY "Users can delete their company files"
ON storage.objects
FOR DELETE
USING (
  bucket_id IN ('company-documents', 'company-media', 'payment-proofs')
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM companies 
    WHERE id IN (
      SELECT company_id FROM users WHERE id = auth.uid()
    )
  )
);

-- Fix 3: Fix messages table RLS - remove public access, add company-scoped policies
DROP POLICY IF EXISTS "Public access to messages" ON messages;

CREATE POLICY "Users can view their company messages"
ON messages
FOR SELECT
USING (
  conversation_id IN (
    SELECT id FROM conversations 
    WHERE company_id IN (
      SELECT company_id FROM users WHERE id = auth.uid()
    )
  )
);

CREATE POLICY "System can insert messages"
ON messages
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Users can delete their company messages"
ON messages
FOR DELETE
USING (
  conversation_id IN (
    SELECT id FROM conversations 
    WHERE company_id IN (
      SELECT company_id FROM users WHERE id = auth.uid()
    )
  )
);