-- Allow company users to manage their own AI overrides
CREATE POLICY "Users can update their company AI overrides"
ON public.company_ai_overrides
FOR UPDATE
USING (
  company_id IN (
    SELECT company_id FROM public.users WHERE id = auth.uid()
  )
);

CREATE POLICY "Users can insert their company AI overrides"
ON public.company_ai_overrides
FOR INSERT
WITH CHECK (
  company_id IN (
    SELECT company_id FROM public.users WHERE id = auth.uid()
  )
);