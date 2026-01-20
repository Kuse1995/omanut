-- Drop and recreate the delete_company function to handle ALL related tables
-- and properly clean up auth.users to allow email reuse

CREATE OR REPLACE FUNCTION public.delete_company(p_company_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_deleted_users int := 0;
  v_company_name text;
BEGIN
  -- Verify caller is admin
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;
  
  -- Get company name for logging
  SELECT name INTO v_company_name FROM public.companies WHERE id = p_company_id;
  
  IF v_company_name IS NULL THEN
    RAISE EXCEPTION 'Company not found: %', p_company_id;
  END IF;
  
  -- Delete all related data in correct order (respecting foreign keys)
  -- Messages depend on conversations, so delete messages first
  DELETE FROM public.messages WHERE conversation_id IN (
    SELECT id FROM public.conversations WHERE company_id = p_company_id
  );
  
  -- Delete WhatsApp messages
  DELETE FROM public.whatsapp_messages WHERE company_id = p_company_id;
  
  -- Delete media delivery status
  DELETE FROM public.media_delivery_status WHERE company_id = p_company_id;
  
  -- Delete digital product deliveries (depends on payment_transactions and payment_products)
  DELETE FROM public.digital_product_deliveries WHERE company_id = p_company_id;
  
  -- Delete image generation feedback (depends on generated_images)
  DELETE FROM public.image_generation_feedback WHERE company_id = p_company_id;
  
  -- Delete message reply drafts
  DELETE FROM public.message_reply_drafts WHERE company_id = p_company_id;
  
  -- Delete credit usage
  DELETE FROM public.credit_usage WHERE company_id = p_company_id;
  
  -- Delete action items
  DELETE FROM public.action_items WHERE company_id = p_company_id;
  
  -- Delete client information
  DELETE FROM public.client_information WHERE company_id = p_company_id;
  
  -- Delete boss conversations
  DELETE FROM public.boss_conversations WHERE company_id = p_company_id;
  
  -- Delete generated images
  DELETE FROM public.generated_images WHERE company_id = p_company_id;
  
  -- Delete payment transactions
  DELETE FROM public.payment_transactions WHERE company_id = p_company_id;
  
  -- Delete payment products
  DELETE FROM public.payment_products WHERE company_id = p_company_id;
  
  -- Delete reservations
  DELETE FROM public.reservations WHERE company_id = p_company_id;
  
  -- Delete conversations
  DELETE FROM public.conversations WHERE company_id = p_company_id;
  
  -- Delete company AI overrides
  DELETE FROM public.company_ai_overrides WHERE company_id = p_company_id;
  
  -- Delete company documents
  DELETE FROM public.company_documents WHERE company_id = p_company_id;
  
  -- Delete company media
  DELETE FROM public.company_media WHERE company_id = p_company_id;
  
  -- Delete image generation settings
  DELETE FROM public.image_generation_settings WHERE company_id = p_company_id;
  
  -- Delete quick reply templates
  DELETE FROM public.quick_reply_templates WHERE company_id = p_company_id;
  
  -- Delete AI playground sessions
  DELETE FROM public.ai_playground_sessions WHERE company_id = p_company_id;
  
  -- Delete AI error logs
  DELETE FROM public.ai_error_logs WHERE company_id = p_company_id;
  
  -- Delete agent performance records
  DELETE FROM public.agent_performance WHERE company_id = p_company_id;
  
  -- Delete customer segments
  DELETE FROM public.customer_segments WHERE company_id = p_company_id;
  
  -- Delete calendar conflicts
  DELETE FROM public.calendar_conflicts WHERE company_id = p_company_id;
  
  -- Delete takeover sessions
  DELETE FROM public.takeover_sessions WHERE company_id = p_company_id;
  
  -- Delete onboarding sessions
  DELETE FROM public.onboarding_sessions WHERE created_company_id = p_company_id;
  
  -- Delete security events
  DELETE FROM public.security_events WHERE company_id = p_company_id;
  
  -- Get users to delete from BOTH legacy users table AND company_users table
  -- First handle company_users (multi-tenant) - get users who ONLY belong to this company
  FOR v_user_id IN 
    SELECT cu.user_id 
    FROM public.company_users cu
    WHERE cu.company_id = p_company_id
    AND NOT EXISTS (
      -- User doesn't belong to any OTHER company
      SELECT 1 FROM public.company_users cu2 
      WHERE cu2.user_id = cu.user_id 
      AND cu2.company_id != p_company_id
    )
  LOOP
    -- Delete from auth.users (this will cascade to user_roles and company_users)
    DELETE FROM auth.users WHERE id = v_user_id;
    v_deleted_users := v_deleted_users + 1;
  END LOOP;
  
  -- Remove company_users entries for users who belong to multiple companies
  -- (they keep their account but lose access to this company)
  DELETE FROM public.company_users WHERE company_id = p_company_id;
  
  -- Handle legacy users table
  FOR v_user_id IN 
    SELECT id FROM public.users WHERE company_id = p_company_id
  LOOP
    -- Check if this user was already deleted via company_users
    IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id) THEN
      DELETE FROM auth.users WHERE id = v_user_id;
      v_deleted_users := v_deleted_users + 1;
    END IF;
  END LOOP;
  
  -- Delete from public.users (should already be cleaned up by cascade, but just in case)
  DELETE FROM public.users WHERE company_id = p_company_id;
  
  -- Finally delete the company
  DELETE FROM public.companies WHERE id = p_company_id;
  
  -- Return success with details
  RETURN json_build_object(
    'success', true,
    'company_id', p_company_id,
    'company_name', v_company_name,
    'deleted_users', v_deleted_users,
    'message', 'Company and all related data deleted successfully. Auth users removed to allow email reuse.'
  );
END;
$$;