
CREATE TABLE IF NOT EXISTS public.company_agent_modes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'MessageSquare',
  system_prompt TEXT NOT NULL DEFAULT '',
  trigger_keywords TEXT[] NOT NULL DEFAULT '{}',
  trigger_examples TEXT[] NOT NULL DEFAULT '{}',
  enabled_tools TEXT[] NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT true,
  priority INT NOT NULL DEFAULT 100,
  is_default BOOLEAN NOT NULL DEFAULT false,
  pauses_for_human BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_company_agent_modes_company ON public.company_agent_modes(company_id);
CREATE INDEX IF NOT EXISTS idx_company_agent_modes_enabled ON public.company_agent_modes(company_id, enabled, priority);

ALTER TABLE public.company_agent_modes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can view agent modes"
ON public.company_agent_modes FOR SELECT TO authenticated
USING (user_has_company_access_v2(company_id));

CREATE POLICY "Managers can insert agent modes"
ON public.company_agent_modes FOR INSERT TO authenticated
WITH CHECK (has_company_role(company_id, 'manager'::company_role));

CREATE POLICY "Managers can update agent modes"
ON public.company_agent_modes FOR UPDATE TO authenticated
USING (has_company_role(company_id, 'manager'::company_role));

CREATE POLICY "Owners can delete agent modes"
ON public.company_agent_modes FOR DELETE TO authenticated
USING (has_company_role(company_id, 'owner'::company_role));

CREATE POLICY "Platform admins full access to agent modes"
ON public.company_agent_modes FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role full access on agent modes"
ON public.company_agent_modes FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Inline updated_at trigger (no shared helper)
CREATE OR REPLACE FUNCTION public.touch_company_agent_modes_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_company_agent_modes_updated_at
BEFORE UPDATE ON public.company_agent_modes
FOR EACH ROW EXECUTE FUNCTION public.touch_company_agent_modes_updated_at();

CREATE OR REPLACE FUNCTION public.seed_company_agent_modes(_company_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    (company_id, slug, name, icon, system_prompt, trigger_keywords, trigger_examples, enabled, priority, is_default, pauses_for_human, description)
  VALUES
  (_company_id, 'support', 'Customer Care', 'HeadphonesIcon',
    COALESCE(v_overrides.support_agent_prompt, 'You are the Customer Care Agent. Be empathetic, listen carefully to complaints, acknowledge frustration, and provide clear solutions.'),
    ARRAY['issue','problem','wrong','broken','not working','help','complaint','disappointed','frustrated','refund'],
    ARRAY['I have a problem with my order','This is not working','Can you help me?'],
    true, 20, true, false, 'Empathy, issue resolution, complaint handling'),
  (_company_id, 'sales', 'Sales', 'TrendingUp',
    COALESCE(v_overrides.sales_agent_prompt, 'You are the Sales Agent. Highlight product benefits, ask qualifying questions, and guide customers toward purchase.'),
    ARRAY['price','cost','buy','purchase','order','available','recommend','show me','pay','payment','checkout'],
    ARRAY['How much is X?','Do you have Y?','I want to buy this'],
    true, 10, false, false, 'Persuasion, product knowledge, closing deals, autonomous checkout'),
  (_company_id, 'boss', 'Boss / Management', 'Crown',
    COALESCE(v_overrides.boss_agent_prompt, 'You are escalating this conversation to the business owner. Summarise context clearly.'),
    ARRAY['manager','owner','speak to a person','lawsuit','legal','fraud','threat'],
    ARRAY['I want to speak to the manager','This is fraud','I will sue you'],
    true, 5, false, true, 'Strategic escalation for critical issues only');
END;
$$;

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN SELECT DISTINCT company_id FROM public.company_ai_overrides LOOP
    PERFORM public.seed_company_agent_modes(c.company_id);
  END LOOP;
END $$;
