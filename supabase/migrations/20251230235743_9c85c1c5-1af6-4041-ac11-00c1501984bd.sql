-- Phase 1: Create Company Role Enum and company_users Table

-- 1.1 Create the company_role enum for granular permissions
CREATE TYPE public.company_role AS ENUM ('owner', 'manager', 'contributor', 'viewer');

-- 1.2 Create the company_users junction table for multi-tenant access
CREATE TABLE public.company_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    role company_role NOT NULL DEFAULT 'viewer',
    is_default BOOLEAN DEFAULT false,
    invited_by UUID REFERENCES auth.users(id),
    invited_at TIMESTAMPTZ DEFAULT now(),
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, company_id)
);

-- Enable RLS on company_users
ALTER TABLE public.company_users ENABLE ROW LEVEL SECURITY;

-- Create index for performance
CREATE INDEX idx_company_users_user_id ON public.company_users(user_id);
CREATE INDEX idx_company_users_company_id ON public.company_users(company_id);

-- 1.3 Create Security Definer Functions

-- Check if user has access to a company (v2 - uses company_users)
CREATE OR REPLACE FUNCTION public.user_has_company_access_v2(company_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_users 
    WHERE user_id = auth.uid() 
    AND company_id = company_uuid
  );
$$;

-- Check if user has specific company role or higher
-- Role hierarchy: owner(0) < manager(1) < contributor(2) < viewer(3)
CREATE OR REPLACE FUNCTION public.has_company_role(
  company_uuid UUID, 
  required_role company_role
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_users 
    WHERE user_id = auth.uid() 
    AND company_id = company_uuid
    AND (
      CASE role
        WHEN 'owner' THEN 0
        WHEN 'manager' THEN 1
        WHEN 'contributor' THEN 2
        WHEN 'viewer' THEN 3
      END
    ) <= (
      CASE required_role
        WHEN 'owner' THEN 0
        WHEN 'manager' THEN 1
        WHEN 'contributor' THEN 2
        WHEN 'viewer' THEN 3
      END
    )
  );
$$;

-- Check if user can manage company users (owner or manager)
CREATE OR REPLACE FUNCTION public.can_manage_company_users(company_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_users 
    WHERE user_id = auth.uid() 
    AND company_id = company_uuid
    AND role IN ('owner', 'manager')
  );
$$;

-- Get user's companies with roles
CREATE OR REPLACE FUNCTION public.get_user_companies()
RETURNS TABLE(company_id UUID, company_name TEXT, role company_role, is_default BOOLEAN)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cu.company_id, c.name, cu.role, cu.is_default
  FROM public.company_users cu
  JOIN public.companies c ON c.id = cu.company_id
  WHERE cu.user_id = auth.uid();
$$;

-- Get user's role in a specific company
CREATE OR REPLACE FUNCTION public.get_user_company_role(company_uuid UUID)
RETURNS company_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.company_users 
  WHERE user_id = auth.uid() 
  AND company_id = company_uuid
  LIMIT 1;
$$;

-- 1.4 Migrate existing users to company_users (make them owners)
INSERT INTO public.company_users (user_id, company_id, role, is_default, accepted_at)
SELECT 
  u.id as user_id, 
  u.company_id, 
  'owner'::company_role as role,
  true as is_default,
  u.created_at as accepted_at
FROM public.users u
WHERE u.company_id IS NOT NULL
ON CONFLICT (user_id, company_id) DO NOTHING;

-- 1.5 RLS Policies for company_users table

-- Users can view their own memberships
CREATE POLICY "Users can view own memberships" ON public.company_users
FOR SELECT USING (user_id = auth.uid());

-- Company admins (owner/manager) can view all company members
CREATE POLICY "Company admins can view members" ON public.company_users
FOR SELECT USING (can_manage_company_users(company_id));

-- Company admins can invite users (but not grant owner role unless they are owner)
CREATE POLICY "Company admins can invite" ON public.company_users
FOR INSERT WITH CHECK (
  can_manage_company_users(company_id)
  AND (role != 'owner' OR has_company_role(company_id, 'owner'))
);

-- Owners can update roles
CREATE POLICY "Owners can update roles" ON public.company_users
FOR UPDATE USING (
  has_company_role(company_id, 'owner')
  OR (user_id = auth.uid()) -- Users can update their own is_default
);

-- Owners can remove members (except themselves if last owner)
CREATE POLICY "Owners can remove members" ON public.company_users
FOR DELETE USING (
  has_company_role(company_id, 'owner')
  AND user_id != auth.uid() -- Can't remove yourself
);

-- Platform admins have full access
CREATE POLICY "Platform admins full access" ON public.company_users
FOR ALL USING (has_role(auth.uid(), 'admin'));

-- 1.6 Update trigger for updated_at
CREATE TRIGGER update_company_users_updated_at
BEFORE UPDATE ON public.company_users
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();