-- 1. Update seed function to use baseline defaults for new companies
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
    'google/gemini-2.5-flash',
    'google/gemini-3-flash-preview',
    'deepseek-chat',
    4096,
    4,
    30,
    'Give me one moment — I''m checking on that for you. 🙏',
    ARRAY[
      'lookup_product','list_media','send_media','notify_boss',
      'create_scheduled_post','check_stock','list_products','check_customer',
      'record_sale','generate_payment_link',
      'bms_list_products','bms_check_stock'
    ],
    'For current stock and prices, always call check_stock or list_products. Do not quote prices from memory.',
    '',
    ''
  )
  ON CONFLICT (company_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- 2. Backfill existing companies: raise rounds and tokens to baseline
UPDATE public.company_ai_overrides
SET max_tool_rounds = 4
WHERE COALESCE(max_tool_rounds, 0) < 4;

UPDATE public.company_ai_overrides
SET max_tokens = 4096
WHERE COALESCE(max_tokens, 0) < 4096;

-- 3. Backfill enabled_tools for all companies (universal tools, plus BMS tools where applicable)
-- Universal tool set (always added)
WITH universal AS (
  SELECT ARRAY[
    'lookup_product','list_media','send_media','notify_boss',
    'create_scheduled_post','check_customer'
  ]::text[] AS tools
),
bms_companies AS (
  SELECT DISTINCT company_id FROM public.bms_connections WHERE is_active = true
)
UPDATE public.company_ai_overrides o
SET enabled_tools = (
  SELECT ARRAY(
    SELECT DISTINCT unnest(
      COALESCE(o.enabled_tools, ARRAY[]::text[]) ||
      (SELECT tools FROM universal) ||
      CASE WHEN o.company_id IN (SELECT company_id FROM bms_companies)
        THEN ARRAY['check_stock','list_products','record_sale','generate_payment_link','bms_list_products','bms_check_stock']::text[]
        ELSE ARRAY[]::text[]
      END
    )
  )
);

-- 4. Seed agent modes for any company that has none
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN SELECT id FROM public.companies LOOP
    PERFORM public.seed_company_agent_modes(c.id);
  END LOOP;
END $$;