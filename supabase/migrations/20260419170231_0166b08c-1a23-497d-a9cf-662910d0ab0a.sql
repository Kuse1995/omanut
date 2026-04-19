-- Auto-seed company_ai_overrides for new companies with sensible defaults
CREATE OR REPLACE FUNCTION public.seed_company_ai_overrides()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    1024,
    4,
    30,
    'Give me one moment — I''m checking on that for you. 🙏',
    ARRAY[
      'lookup_product','list_media','send_media','notify_boss',
      'create_scheduled_post','check_stock','check_customer',
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
$$;

DROP TRIGGER IF EXISTS trg_seed_company_ai_overrides ON public.companies;
CREATE TRIGGER trg_seed_company_ai_overrides
AFTER INSERT ON public.companies
FOR EACH ROW
EXECUTE FUNCTION public.seed_company_ai_overrides();