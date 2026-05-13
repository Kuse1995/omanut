-- Fix routing model: switch reasoning-tier models to a deterministic JSON model.
-- Reasoning models burn the token budget in `reasoning_content` and return empty
-- `content`, which crashes the router and pins every conversation to the
-- is_default agent mode (Customer Care).

UPDATE public.company_ai_overrides
SET routing_model = 'google/gemini-2.5-flash-lite'
WHERE routing_model IS NULL
   OR routing_model IN (
     'glm-4.5-air','glm-4.6','glm-4.7',
     'deepseek-reasoner','deepseek-chat',
     'MiniMax-M2','minimax-m2'
   )
   OR routing_model ILIKE '%-thinking%'
   OR routing_model ILIKE '%-reasoning%';

-- Update the seed trigger so newly created companies get a sane router default.
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
    'google/gemini-2.5-flash-lite',
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