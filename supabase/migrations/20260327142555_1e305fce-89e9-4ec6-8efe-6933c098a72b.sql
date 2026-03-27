
-- Agent spending limits (guardrails)
CREATE TABLE public.agent_spending_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  daily_ad_budget_limit NUMERIC DEFAULT 50,
  sale_approval_threshold NUMERIC DEFAULT 500,
  require_approval_for_ai_config BOOLEAN DEFAULT true,
  require_approval_for_publishing BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id)
);

ALTER TABLE public.agent_spending_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company users can view spending limits"
  ON public.agent_spending_limits FOR SELECT TO authenticated
  USING (public.user_has_company_access_v2(company_id));

CREATE POLICY "Service role full access on spending limits"
  ON public.agent_spending_limits FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Agent approval requests (HITL)
CREATE TABLE public.agent_approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  action_type TEXT NOT NULL,
  action_summary TEXT NOT NULL,
  action_params JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending',
  requested_at TIMESTAMPTZ DEFAULT now(),
  responded_at TIMESTAMPTZ,
  responded_by TEXT
);

ALTER TABLE public.agent_approval_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company users can view approval requests"
  ON public.agent_approval_requests FOR SELECT TO authenticated
  USING (public.user_has_company_access_v2(company_id));

CREATE POLICY "Service role full access on approval requests"
  ON public.agent_approval_requests FOR ALL TO service_role
  USING (true) WITH CHECK (true);
