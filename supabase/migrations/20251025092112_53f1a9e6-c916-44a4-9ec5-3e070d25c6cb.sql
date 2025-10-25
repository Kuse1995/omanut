-- Clear the duplicate WhatsApp number from the older company
UPDATE public.companies 
SET whatsapp_number = NULL 
WHERE id = 'ded116eb-ba6c-482f-9347-1f0a5f8d5ec2';

-- Create delete_company function that cascades deletions
CREATE OR REPLACE FUNCTION public.delete_company(p_company_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Verify caller is admin
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;
  
  -- Delete all related data in correct order (respecting foreign keys)
  DELETE FROM public.credit_usage WHERE company_id = p_company_id;
  DELETE FROM public.reservations WHERE company_id = p_company_id;
  DELETE FROM public.conversations WHERE company_id = p_company_id;
  DELETE FROM public.company_ai_overrides WHERE company_id = p_company_id;
  
  -- Delete users and their roles
  DELETE FROM public.user_roles WHERE user_id IN (
    SELECT id FROM public.users WHERE company_id = p_company_id
  );
  DELETE FROM public.users WHERE company_id = p_company_id;
  
  -- Finally delete the company
  DELETE FROM public.companies WHERE id = p_company_id;
  
  -- Return success
  RETURN json_build_object(
    'success', true,
    'company_id', p_company_id,
    'message', 'Company and all related data deleted successfully'
  );
END;
$function$;

-- Add unique partial indexes to prevent duplicate phone numbers (only applies to non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS unique_whatsapp_number_idx ON public.companies (whatsapp_number) 
WHERE whatsapp_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS unique_twilio_number_idx ON public.companies (twilio_number) 
WHERE twilio_number IS NOT NULL;