-- Add message_metadata column to messages table for storing media information
ALTER TABLE public.messages 
ADD COLUMN message_metadata JSONB DEFAULT '{}'::jsonb;

-- Create storage bucket for conversation media
INSERT INTO storage.buckets (id, name, public) 
VALUES ('conversation-media', 'conversation-media', false);

-- Create RLS policies for conversation-media bucket
CREATE POLICY "Users can view their company's conversation media"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'conversation-media' 
  AND (storage.foldername(name))[1] IN (
    SELECT c.id::text 
    FROM conversations c
    JOIN users u ON u.company_id = c.company_id
    WHERE u.id = auth.uid()
  )
);

CREATE POLICY "System can insert conversation media"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'conversation-media');

CREATE POLICY "Users can delete their company's conversation media"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'conversation-media'
  AND (storage.foldername(name))[1] IN (
    SELECT c.id::text 
    FROM conversations c
    JOIN users u ON u.company_id = c.company_id
    WHERE u.id = auth.uid()
  )
);