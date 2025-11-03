-- Make company-documents bucket public for chat media
UPDATE storage.buckets 
SET public = true 
WHERE id = 'company-documents';