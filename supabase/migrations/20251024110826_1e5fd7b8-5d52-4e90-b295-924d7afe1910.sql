-- Add transcript and quality_flag to conversations
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS transcript TEXT DEFAULT '';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS quality_flag TEXT DEFAULT '';

-- Create app_role enum for role-based access
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Create user_roles table for secure role management
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check roles (prevents RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- RLS policies for user_roles
CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage all roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Create company_ai_overrides table
CREATE TABLE IF NOT EXISTS public.company_ai_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE UNIQUE NOT NULL,
  system_instructions TEXT NOT NULL DEFAULT '',
  qa_style TEXT NOT NULL DEFAULT '',
  banned_topics TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.company_ai_overrides ENABLE ROW LEVEL SECURITY;

-- RLS for company_ai_overrides: admins can do anything, users can view their company's overrides
CREATE POLICY "Admins can manage all AI overrides"
  ON public.company_ai_overrides FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view their company AI overrides"
  ON public.company_ai_overrides FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id FROM public.users WHERE id = auth.uid()
    )
  );

-- Update companies RLS to allow admins full access
DROP POLICY IF EXISTS "Public access to companies" ON public.companies;

CREATE POLICY "Admins can manage all companies"
  ON public.companies FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view their own company"
  ON public.companies FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT company_id FROM public.users WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own company settings"
  ON public.companies FOR UPDATE
  TO authenticated
  USING (
    id IN (
      SELECT company_id FROM public.users WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    id IN (
      SELECT company_id FROM public.users WHERE id = auth.uid()
    )
  );

-- Update conversations RLS
DROP POLICY IF EXISTS "Public access to conversations" ON public.conversations;

CREATE POLICY "Admins can view all conversations"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view their company conversations"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id FROM public.users WHERE id = auth.uid()
    )
  );

CREATE POLICY "Admins can update conversations"
  ON public.conversations FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Update reservations RLS
DROP POLICY IF EXISTS "Public access to reservations" ON public.reservations;

CREATE POLICY "Admins can view all reservations"
  ON public.reservations FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view their company reservations"
  ON public.reservations FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id FROM public.users WHERE id = auth.uid()
    )
  );

-- Update credit_usage RLS
DROP POLICY IF EXISTS "Public access to credit_usage" ON public.credit_usage;

CREATE POLICY "Admins can view all credit usage"
  ON public.credit_usage FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view their company credit usage"
  ON public.credit_usage FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id FROM public.users WHERE id = auth.uid()
    )
  );

-- Helper function to add credits (for admin top-ups)
CREATE OR REPLACE FUNCTION public.add_credits(
  p_company_id UUID,
  p_amount INTEGER,
  p_reason TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.companies 
  SET credit_balance = credit_balance + p_amount
  WHERE id = p_company_id;
  
  INSERT INTO public.credit_usage(company_id, amount_used, reason)
  VALUES(p_company_id, -p_amount, p_reason);
END;
$$;