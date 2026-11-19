-- Platform admins (user_roles.admin) act with owner-level access on every company,
-- so they can run setup and connect accounts for any business.
CREATE OR REPLACE FUNCTION public.has_company_role(company_uuid uuid, required_role company_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.has_role(auth.uid(), 'admin'::app_role) OR EXISTS (
    SELECT 1 FROM public.company_users
    WHERE user_id = auth.uid()
    AND company_id = company_uuid
    AND (
      CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'contributor' THEN 2 WHEN 'viewer' THEN 3 END
    ) <= (
      CASE required_role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'contributor' THEN 2 WHEN 'viewer' THEN 3 END
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.user_has_company_access_v2(company_uuid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.has_role(auth.uid(), 'admin'::app_role) OR EXISTS (
    SELECT 1 FROM public.company_users
    WHERE user_id = auth.uid()
    AND company_id = company_uuid
  );
$function$;