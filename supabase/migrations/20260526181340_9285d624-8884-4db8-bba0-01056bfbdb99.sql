UPDATE public.company_ai_overrides
SET enabled_tools = ARRAY(
  SELECT DISTINCT unnest(enabled_tools || ARRAY['send_message','check_stock','lookup_product','request_payment','update_customer'])
)
WHERE company_id = '3408d643-8e9c-4c46-b684-4960fba1e0e9';