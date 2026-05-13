-- Make MiniMax-M2 the primary text/tool-calling model for newly-seeded companies.
-- Existing companies' company_ai_overrides are left untouched.
CREATE OR REPLACE FUNCTION public.seed_company_ai_overrides()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.company_ai_overrides (
    company_id,
    primary_model,
    analysis_model,
    routing_model,
    max_tokens,
    max_tool_rounds,
    response_timeout_seconds,
    fallback_message,
    enabled_tools,
    system_instructions,
    banned_topics,
    qa_style
  ) VALUES (
    NEW.id,
    'MiniMax-M2',
    'google/gemini-3-flash-preview',
    'MiniMax-M2',
    4096,
    4,
    30,
    'Let me get our owner involved — they''ll respond shortly.',
    ARRAY[
      'search_media','send_media','search_knowledge','search_past_conversations',
      'notify_boss','check_customer','create_scheduled_post',
      'get_date_info','check_availability','create_reservation'
    ],
    'For media requests, always call search_media first and never fabricate URLs. Never promise an action you cannot perform with an available tool.',
    '',
    ''
  )
  ON CONFLICT (company_id) DO NOTHING;
  RETURN NEW;
END;
$function$;