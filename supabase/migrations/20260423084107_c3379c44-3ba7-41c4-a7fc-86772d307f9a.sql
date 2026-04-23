-- Add per-agent model column
ALTER TABLE public.company_agent_modes
  ADD COLUMN IF NOT EXISTS model text NULL;

COMMENT ON COLUMN public.company_agent_modes.model IS
  'AI model id (e.g. glm-4.7, gemini-2.5-pro, deepseek-chat, kimi-k2-0711-preview). NULL = inherit company default primary_model.';

-- Backfill: Boss agent rows get gemini-2.5-pro by default
UPDATE public.company_agent_modes
SET model = 'gemini-2.5-pro'
WHERE slug = 'boss' AND model IS NULL;

-- Update seed function so new companies follow the same defaults
CREATE OR REPLACE FUNCTION public.seed_company_agent_modes(_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_overrides RECORD;
  v_existing_count INT;
BEGIN
  SELECT COUNT(*) INTO v_existing_count
  FROM public.company_agent_modes WHERE company_id = _company_id;
  IF v_existing_count > 0 THEN RETURN; END IF;

  SELECT support_agent_prompt, sales_agent_prompt, boss_agent_prompt
  INTO v_overrides
  FROM public.company_ai_overrides WHERE company_id = _company_id;

  INSERT INTO public.company_agent_modes
    (company_id, slug, name, icon, system_prompt, trigger_keywords, trigger_examples, enabled, priority, is_default, pauses_for_human, description, model)
  VALUES
  (_company_id, 'support', 'Customer Care', 'HeadphonesIcon',
    COALESCE(v_overrides.support_agent_prompt, 'You are the Customer Care Agent. Be empathetic, listen carefully to complaints, acknowledge frustration, and provide clear solutions.'),
    ARRAY['issue','problem','wrong','broken','not working','help','complaint','disappointed','frustrated','refund'],
    ARRAY['I have a problem with my order','This is not working','Can you help me?'],
    true, 20, true, false, 'Empathy, issue resolution, complaint handling', NULL),
  (_company_id, 'sales', 'Sales', 'TrendingUp',
    COALESCE(v_overrides.sales_agent_prompt, 'You are the Sales Agent. Highlight product benefits, ask qualifying questions, and guide customers toward purchase.'),
    ARRAY['price','cost','buy','purchase','order','available','recommend','show me','pay','payment','checkout'],
    ARRAY['How much is X?','Do you have Y?','I want to buy this'],
    true, 10, false, false, 'Persuasion, product knowledge, closing deals, autonomous checkout', NULL),
  (_company_id, 'boss', 'Boss / Management', 'Crown',
    COALESCE(v_overrides.boss_agent_prompt, 'You are escalating this conversation to the business owner. Summarise context clearly.'),
    ARRAY['manager','owner','speak to a person','lawsuit','legal','fraud','threat'],
    ARRAY['I want to speak to the manager','This is fraud','I will sue you'],
    true, 5, false, true, 'Strategic escalation for critical issues only', 'gemini-2.5-pro');
END;
$function$;