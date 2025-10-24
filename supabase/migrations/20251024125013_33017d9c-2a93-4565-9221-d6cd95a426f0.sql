-- Add INSERT policy for conversations table
CREATE POLICY "Admins can create conversations"
ON public.conversations
FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Also allow users to create conversations for their company
CREATE POLICY "Users can create conversations for their company"
ON public.conversations
FOR INSERT
TO authenticated
WITH CHECK (company_id IN (
  SELECT users.company_id
  FROM users
  WHERE users.id = auth.uid()
));