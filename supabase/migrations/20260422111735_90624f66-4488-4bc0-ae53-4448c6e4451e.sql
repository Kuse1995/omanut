-- Allow platform admins to fully manage company_boss_phones (mirrors companies table)
CREATE POLICY "Admins can view all boss phones"
  ON public.company_boss_phones
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert boss phones"
  ON public.company_boss_phones
  FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update boss phones"
  ON public.company_boss_phones
  FOR UPDATE
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete boss phones"
  ON public.company_boss_phones
  FOR DELETE
  USING (has_role(auth.uid(), 'admin'::app_role));