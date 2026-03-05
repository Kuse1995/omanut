
CREATE TABLE public.agent_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  posts_per_week integer NOT NULL DEFAULT 3,
  target_audience text DEFAULT '',
  preferred_tone text DEFAULT 'professional',
  content_themes text[] DEFAULT '{}',
  preferred_posting_days text[] DEFAULT '{Monday,Wednesday,Friday}',
  preferred_posting_time text DEFAULT '10:00',
  notes text DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(company_id)
);

ALTER TABLE public.agent_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can view agent settings"
  ON public.agent_settings FOR SELECT
  USING (user_has_company_access_v2(company_id));

CREATE POLICY "Managers can update agent settings"
  ON public.agent_settings FOR UPDATE
  USING (has_company_role(company_id, 'manager'::company_role));

CREATE POLICY "Managers can insert agent settings"
  ON public.agent_settings FOR INSERT
  WITH CHECK (has_company_role(company_id, 'manager'::company_role));

CREATE POLICY "Platform admins full access"
  ON public.agent_settings FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "System can manage agent settings"
  ON public.agent_settings FOR ALL
  USING (true)
  WITH CHECK (true);
