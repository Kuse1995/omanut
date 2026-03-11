
CREATE TABLE public.product_identity_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  media_id uuid REFERENCES public.company_media(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  visual_fingerprint jsonb DEFAULT '{}'::jsonb,
  exclusion_keywords text[] DEFAULT '{}'::text[],
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_identity_profiles ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY "Platform admins full access to product profiles"
ON public.product_identity_profiles FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Company members can view
CREATE POLICY "Company members can view product profiles"
ON public.product_identity_profiles FOR SELECT
TO authenticated
USING (user_has_company_access_v2(company_id));

-- Managers can insert
CREATE POLICY "Managers can insert product profiles"
ON public.product_identity_profiles FOR INSERT
TO authenticated
WITH CHECK (has_company_role(company_id, 'manager'::company_role));

-- Managers can update
CREATE POLICY "Managers can update product profiles"
ON public.product_identity_profiles FOR UPDATE
TO authenticated
USING (has_company_role(company_id, 'manager'::company_role));

-- Owners can delete
CREATE POLICY "Owners can delete product profiles"
ON public.product_identity_profiles FOR DELETE
TO authenticated
USING (has_company_role(company_id, 'owner'::company_role));

-- System can insert (for edge functions)
CREATE POLICY "System can insert product profiles"
ON public.product_identity_profiles FOR INSERT
TO public
WITH CHECK (true);

-- System can update (for edge functions)
CREATE POLICY "System can update product profiles"
ON public.product_identity_profiles FOR UPDATE
TO public
USING (true);

-- Trigger for updated_at
CREATE TRIGGER update_product_identity_profiles_updated_at
  BEFORE UPDATE ON public.product_identity_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
