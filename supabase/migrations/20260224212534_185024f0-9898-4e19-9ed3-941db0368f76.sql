
-- 1. Add service_mode to company_ai_overrides
ALTER TABLE public.company_ai_overrides 
ADD COLUMN IF NOT EXISTS service_mode text NOT NULL DEFAULT 'autonomous';

-- 2. Add availability columns to company_users
ALTER TABLE public.company_users 
ADD COLUMN IF NOT EXISTS is_available boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS max_concurrent_tickets integer DEFAULT 5,
ADD COLUMN IF NOT EXISTS current_ticket_count integer DEFAULT 0;

-- 3. Add satisfaction_score to support_tickets
ALTER TABLE public.support_tickets 
ADD COLUMN IF NOT EXISTS satisfaction_score integer,
ADD COLUMN IF NOT EXISTS satisfaction_feedback text;

-- 4. Create agent_queue table
CREATE TABLE public.agent_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ticket_id uuid REFERENCES public.support_tickets(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  assigned_agent_id uuid,
  department text,
  priority text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'waiting',
  customer_phone text,
  customer_name text,
  ai_summary text,
  ai_suggested_responses jsonb DEFAULT '[]'::jsonb,
  sla_deadline timestamptz,
  wait_time_seconds integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  completed_at timestamptz
);

ALTER TABLE public.agent_queue ENABLE ROW LEVEL SECURITY;

-- RLS for agent_queue
CREATE POLICY "Company members can view queue"
  ON public.agent_queue FOR SELECT
  USING (user_has_company_access_v2(company_id));

CREATE POLICY "Contributors can insert queue items"
  ON public.agent_queue FOR INSERT
  WITH CHECK (has_company_role(company_id, 'contributor'::company_role));

CREATE POLICY "Contributors can update queue items"
  ON public.agent_queue FOR UPDATE
  USING (has_company_role(company_id, 'contributor'::company_role));

CREATE POLICY "Owners can delete queue items"
  ON public.agent_queue FOR DELETE
  USING (has_company_role(company_id, 'owner'::company_role));

CREATE POLICY "Platform admins full access to queue"
  ON public.agent_queue FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "System can insert queue items"
  ON public.agent_queue FOR INSERT
  WITH CHECK (true);

-- 5. Create company_sla_config table
CREATE TABLE public.company_sla_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  priority text NOT NULL DEFAULT 'medium',
  response_time_minutes integer NOT NULL DEFAULT 30,
  resolution_time_minutes integer NOT NULL DEFAULT 240,
  escalation_after_minutes integer NOT NULL DEFAULT 60,
  notification_channels jsonb DEFAULT '{"dashboard": true, "whatsapp": false}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, priority)
);

ALTER TABLE public.company_sla_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can view SLA config"
  ON public.company_sla_config FOR SELECT
  USING (user_has_company_access_v2(company_id));

CREATE POLICY "Managers can manage SLA config"
  ON public.company_sla_config FOR INSERT
  WITH CHECK (has_company_role(company_id, 'manager'::company_role));

CREATE POLICY "Managers can update SLA config"
  ON public.company_sla_config FOR UPDATE
  USING (has_company_role(company_id, 'manager'::company_role));

CREATE POLICY "Owners can delete SLA config"
  ON public.company_sla_config FOR DELETE
  USING (has_company_role(company_id, 'owner'::company_role));

CREATE POLICY "Platform admins full access to SLA config"
  ON public.company_sla_config FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 6. Create ticket_notes table
CREATE TABLE public.ticket_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  content text NOT NULL,
  is_internal boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ticket_notes ENABLE ROW LEVEL SECURITY;

-- Get company_id from ticket for RLS
CREATE OR REPLACE FUNCTION public.ticket_company_id(p_ticket_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.support_tickets WHERE id = p_ticket_id LIMIT 1;
$$;

CREATE POLICY "Company members can view ticket notes"
  ON public.ticket_notes FOR SELECT
  USING (user_has_company_access_v2(ticket_company_id(ticket_id)));

CREATE POLICY "Contributors can add ticket notes"
  ON public.ticket_notes FOR INSERT
  WITH CHECK (user_has_company_access_v2(ticket_company_id(ticket_id)));

CREATE POLICY "Platform admins full access to ticket notes"
  ON public.ticket_notes FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 7. Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_queue;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_notes;
