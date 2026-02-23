
-- Update delete_company to also clean up company_api_keys
CREATE OR REPLACE FUNCTION public.delete_company(p_company_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_deleted_users int := 0;
  v_company_name text;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;
  
  SELECT name INTO v_company_name FROM public.companies WHERE id = p_company_id;
  
  IF v_company_name IS NULL THEN
    RAISE EXCEPTION 'Company not found: %', p_company_id;
  END IF;
  
  DELETE FROM public.messages WHERE conversation_id IN (
    SELECT id FROM public.conversations WHERE company_id = p_company_id
  );
  DELETE FROM public.whatsapp_messages WHERE company_id = p_company_id;
  DELETE FROM public.media_delivery_status WHERE company_id = p_company_id;
  DELETE FROM public.digital_product_deliveries WHERE company_id = p_company_id;
  DELETE FROM public.image_generation_feedback WHERE company_id = p_company_id;
  DELETE FROM public.message_reply_drafts WHERE company_id = p_company_id;
  DELETE FROM public.credit_usage WHERE company_id = p_company_id;
  DELETE FROM public.action_items WHERE company_id = p_company_id;
  DELETE FROM public.client_information WHERE company_id = p_company_id;
  DELETE FROM public.boss_conversations WHERE company_id = p_company_id;
  DELETE FROM public.generated_images WHERE company_id = p_company_id;
  DELETE FROM public.payment_transactions WHERE company_id = p_company_id;
  DELETE FROM public.payment_products WHERE company_id = p_company_id;
  DELETE FROM public.reservations WHERE company_id = p_company_id;
  DELETE FROM public.conversations WHERE company_id = p_company_id;
  DELETE FROM public.company_ai_overrides WHERE company_id = p_company_id;
  DELETE FROM public.company_documents WHERE company_id = p_company_id;
  DELETE FROM public.company_media WHERE company_id = p_company_id;
  DELETE FROM public.image_generation_settings WHERE company_id = p_company_id;
  DELETE FROM public.quick_reply_templates WHERE company_id = p_company_id;
  DELETE FROM public.ai_playground_sessions WHERE company_id = p_company_id;
  DELETE FROM public.ai_error_logs WHERE company_id = p_company_id;
  DELETE FROM public.agent_performance WHERE company_id = p_company_id;
  DELETE FROM public.customer_segments WHERE company_id = p_company_id;
  DELETE FROM public.calendar_conflicts WHERE company_id = p_company_id;
  DELETE FROM public.takeover_sessions WHERE company_id = p_company_id;
  DELETE FROM public.onboarding_sessions WHERE created_company_id = p_company_id;
  DELETE FROM public.security_events WHERE company_id = p_company_id;
  DELETE FROM public.company_api_keys WHERE company_id = p_company_id;
  
  FOR v_user_id IN 
    SELECT cu.user_id 
    FROM public.company_users cu
    WHERE cu.company_id = p_company_id
    AND NOT EXISTS (
      SELECT 1 FROM public.company_users cu2 
      WHERE cu2.user_id = cu.user_id 
      AND cu2.company_id != p_company_id
    )
  LOOP
    DELETE FROM auth.users WHERE id = v_user_id;
    v_deleted_users := v_deleted_users + 1;
  END LOOP;
  
  DELETE FROM public.company_users WHERE company_id = p_company_id;
  
  FOR v_user_id IN 
    SELECT id FROM public.users WHERE company_id = p_company_id
  LOOP
    IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id) THEN
      DELETE FROM auth.users WHERE id = v_user_id;
      v_deleted_users := v_deleted_users + 1;
    END IF;
  END LOOP;
  
  DELETE FROM public.users WHERE company_id = p_company_id;
  DELETE FROM public.companies WHERE id = p_company_id;
  
  RETURN json_build_object(
    'success', true,
    'company_id', p_company_id,
    'company_name', v_company_name,
    'deleted_users', v_deleted_users,
    'message', 'Company and all related data deleted successfully. Auth users removed to allow email reuse.'
  );
END;
$function$;
