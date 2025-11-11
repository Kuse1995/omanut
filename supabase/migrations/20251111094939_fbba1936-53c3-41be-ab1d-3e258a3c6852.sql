-- Make conversation-media bucket public so media URLs work
UPDATE storage.buckets 
SET public = true 
WHERE id = 'conversation-media';