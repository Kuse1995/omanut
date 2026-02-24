
-- Support Tickets table
CREATE TABLE public.support_tickets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  conversation_id uuid REFERENCES public.conversations(id),
  ticket_number text NOT NULL,
  customer_name text,
  customer_phone text NOT NULL,
  customer_email text,
  issue_summary text NOT NULL,
  issue_category text NOT NULL DEFAULT 'general',
  recommended_department text,
  recommended_employee text,
  service_recommendations jsonb DEFAULT '[]'::jsonb,
  priority text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'open',
  assigned_to text,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

-- Company Departments table
CREATE TABLE public.company_departments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  name text NOT NULL,
  description text,
  contact_info text,
  employees jsonb DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Auto-generate ticket numbers
CREATE OR REPLACE FUNCTION public.generate_ticket_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  next_num integer;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(ticket_number FROM 5) AS integer)), 0) + 1
  INTO next_num
  FROM public.support_tickets
  WHERE company_id = NEW.company_id;
  
  NEW.ticket_number := 'TKT-' || LPAD(next_num::text, 3, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_ticket_number
  BEFORE INSERT ON public.support_tickets
  FOR EACH ROW
  WHEN (NEW.ticket_number = '' OR NEW.ticket_number IS NULL)
  EXECUTE FUNCTION public.generate_ticket_number();

-- Updated_at triggers
CREATE TRIGGER update_support_tickets_updated_at
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_company_departments_updated_at
  BEFORE UPDATE ON public.company_departments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_departments ENABLE ROW LEVEL SECURITY;

-- Support Tickets RLS
CREATE POLICY "Platform admins full access to tickets"
  ON public.support_tickets FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Company members can view tickets"
  ON public.support_tickets FOR SELECT
  USING (user_has_company_access_v2(company_id));

CREATE POLICY "Managers can create tickets"
  ON public.support_tickets FOR INSERT
  WITH CHECK (has_company_role(company_id, 'contributor'::company_role));

CREATE POLICY "Managers can update tickets"
  ON public.support_tickets FOR UPDATE
  USING (has_company_role(company_id, 'contributor'::company_role));

CREATE POLICY "Owners can delete tickets"
  ON public.support_tickets FOR DELETE
  USING (has_company_role(company_id, 'owner'::company_role));

CREATE POLICY "System can insert tickets"
  ON public.support_tickets FOR INSERT
  WITH CHECK (true);

-- Company Departments RLS
CREATE POLICY "Platform admins full access to departments"
  ON public.company_departments FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Company members can view departments"
  ON public.company_departments FOR SELECT
  USING (user_has_company_access_v2(company_id));

CREATE POLICY "Managers can manage departments"
  ON public.company_departments FOR INSERT
  WITH CHECK (has_company_role(company_id, 'manager'::company_role));

CREATE POLICY "Managers can update departments"
  ON public.company_departments FOR UPDATE
  USING (has_company_role(company_id, 'manager'::company_role));

CREATE POLICY "Owners can delete departments"
  ON public.company_departments FOR DELETE
  USING (has_company_role(company_id, 'owner'::company_role));

-- Add to delete_company function cleanup
-- (We'll handle this separately if needed)
