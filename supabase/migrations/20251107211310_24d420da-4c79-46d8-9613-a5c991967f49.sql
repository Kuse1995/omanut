
-- Drop the existing function
DROP FUNCTION IF EXISTS public.delete_company(uuid);

-- Recreate with all tables included
CREATE OR REPLACE FUNCTION public.delete_company(p_company_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Verify caller is admin
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;
  
  -- Delete all related data in correct order (respecting foreign keys)
  DELETE FROM public.credit_usage WHERE company_id = p_company_id;
  DELETE FROM public.action_items WHERE company_id = p_company_id;
  DELETE FROM public.client_information WHERE company_id = p_company_id;
  DELETE FROM public.boss_conversations WHERE company_id = p_company_id;
  DELETE FROM public.generated_images WHERE company_id = p_company_id;
  DELETE FROM public.payment_transactions WHERE company_id = p_company_id;
  DELETE FROM public.reservations WHERE company_id = p_company_id;
  DELETE FROM public.conversations WHERE company_id = p_company_id;
  DELETE FROM public.company_ai_overrides WHERE company_id = p_company_id;
  DELETE FROM public.company_documents WHERE company_id = p_company_id;
  DELETE FROM public.company_media WHERE company_id = p_company_id;
  DELETE FROM public.image_generation_settings WHERE company_id = p_company_id;
  
  -- Delete users from auth.users first, then public tables
  FOR v_user_id IN 
    SELECT id FROM public.users WHERE company_id = p_company_id
  LOOP
    -- Delete from auth.users (this will cascade to public.user_roles)
    DELETE FROM auth.users WHERE id = v_user_id;
  END LOOP;
  
  -- Delete from public.users (should already be cleaned up by cascade, but just in case)
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
$$;
