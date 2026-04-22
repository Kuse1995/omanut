-- 1. Update the seed trigger function to use the runtime tool name `search_media`
-- instead of the non-existent `list_media`, and to drop BMS-specific tools that
-- only make sense for companies with an active bms_connections row.
-- Companies with BMS will get their BMS tools added back manually or by the
-- BMS connection setup flow.
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
      'search_media','send_media','notify_boss',
      'create_scheduled_post','check_customer'
    ],
    'For media requests, always call search_media first and never fabricate URLs.',
    '',
    ''
  )
  ON CONFLICT (company_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- 2. Backfill: replace `list_media` with `search_media` in every existing row.
UPDATE public.company_ai_overrides
SET enabled_tools = array_replace(enabled_tools, 'list_media', 'search_media'),
    updated_at = now()
WHERE 'list_media' = ANY(enabled_tools);

-- 3. Backfill: strip BMS-related tools from companies that have NO active BMS
-- connection. Without a connection, these tools always fail and trap the AI in
-- a "one moment" stall loop.
WITH no_bms AS (
  SELECT c.id AS company_id
  FROM public.companies c
  LEFT JOIN public.bms_connections b
    ON b.company_id = c.id AND b.is_active = true
  WHERE b.id IS NULL
),
bms_tools AS (
  SELECT unnest(ARRAY[
    'check_stock','list_products','record_sale','generate_payment_link',
    'bms_list_products','bms_check_stock','lookup_product'
  ]) AS tool
)
UPDATE public.company_ai_overrides o
SET enabled_tools = (
      SELECT COALESCE(array_agg(t), ARRAY[]::text[])
      FROM unnest(o.enabled_tools) t
      WHERE t NOT IN (SELECT tool FROM bms_tools)
    ),
    updated_at = now()
WHERE o.company_id IN (SELECT company_id FROM no_bms)
  AND EXISTS (
    SELECT 1 FROM unnest(o.enabled_tools) t
    WHERE t IN (SELECT tool FROM bms_tools)
  );