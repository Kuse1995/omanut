-- Make company-media bucket public so Twilio can download media files
UPDATE storage.buckets 
SET public = true 
WHERE id = 'company-media';