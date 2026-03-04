
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
  v_all_user_ids uuid[];
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;
  
  SELECT name INTO v_company_name FROM public.companies WHERE id = p_company_id;
  
  IF v_company_name IS NULL THEN
    RAISE EXCEPTION 'Company not found: %', p_company_id;
  END IF;

  -- Collect ALL user IDs from both tables, deduplicated
  SELECT ARRAY(
    SELECT DISTINCT uid FROM (
      SELECT user_id AS uid FROM public.company_users WHERE company_id = p_company_id
      UNION
      SELECT id AS uid FROM public.users WHERE company_id = p_company_id
    ) sub
  ) INTO v_all_user_ids;

  -- Delete conversation-dependent data first
  DELETE FROM public.messages WHERE conversation_id IN (
    SELECT id FROM public.conversations WHERE company_id = p_company_id
  );
  
  -- Delete ticket notes before tickets (FK: ticket_notes.ticket_id -> support_tickets.id)
  DELETE FROM public.ticket_notes WHERE ticket_id IN (
    SELECT id FROM public.support_tickets WHERE company_id = p_company_id
  );
  
  -- Delete agent_queue before tickets (FK: agent_queue.ticket_id -> support_tickets.id)
  DELETE FROM public.agent_queue WHERE company_id = p_company_id;
  
  -- Delete support_tickets
  DELETE FROM public.support_tickets WHERE company_id = p_company_id;

  -- Delete all other company-scoped data
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
  DELETE FROM public.company_sla_config WHERE company_id = p_company_id;
  DELETE FROM public.company_departments WHERE company_id = p_company_id;
  DELETE FROM public.demo_sessions WHERE company_id = p_company_id;

  -- Delete user_roles for all collected users (safety net before auth.users deletion)
  IF array_length(v_all_user_ids, 1) > 0 THEN
    DELETE FROM public.user_roles WHERE user_id = ANY(v_all_user_ids);
  END IF;

  -- Delete company_users junction rows
  DELETE FROM public.company_users WHERE company_id = p_company_id;

  -- Delete public.users rows (must happen before companies due to FK)
  DELETE FROM public.users WHERE company_id = p_company_id;

  -- Now delete auth.users for single-company users only
  IF array_length(v_all_user_ids, 1) > 0 THEN
    FOR v_user_id IN SELECT unnest(v_all_user_ids)
    LOOP
      -- Only delete if user has no remaining company memberships
      IF NOT EXISTS (
        SELECT 1 FROM public.company_users WHERE user_id = v_user_id
      ) AND NOT EXISTS (
        SELECT 1 FROM public.users WHERE id = v_user_id
      ) THEN
        DELETE FROM auth.users WHERE id = v_user_id;
        v_deleted_users := v_deleted_users + 1;
      END IF;
    END LOOP;
  END IF;

  -- Finally delete the company itself
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
