-- Add RLS policy for users to update conversations in their company
CREATE POLICY "Users can update their company conversations"
ON public.conversations
FOR UPDATE
TO authenticated
USING (
  company_id IN (
    SELECT company_id 
    FROM public.users 
    WHERE id = auth.uid()
  )
)
WITH CHECK (
  company_id IN (
    SELECT company_id 
    FROM public.users 
    WHERE id = auth.uid()
  )
);