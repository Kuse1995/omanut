-- Drop existing insert policy first, then recreate with new name
DROP POLICY IF EXISTS "System can insert facebook messages" ON public.facebook_messages;

-- Recreate with new name to avoid conflict
CREATE POLICY "System can insert facebook messages v2"
ON public.facebook_messages
FOR INSERT
WITH CHECK (true);