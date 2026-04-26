-- Per-company WhatsApp Cloud API credentials (only populated for opt-in companies)
CREATE TABLE public.company_whatsapp_cloud (
  company_id UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  waba_id TEXT NOT NULL,
  phone_number_id TEXT NOT NULL UNIQUE,
  display_phone_number TEXT NOT NULL,
  business_name TEXT,
  access_token TEXT NOT NULL,
  webhook_subscribed_at TIMESTAMPTZ,
  health_status TEXT NOT NULL DEFAULT 'pending',
  connected_via TEXT NOT NULL DEFAULT 'embedded_signup',
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_company_whatsapp_cloud_phone_number_id
  ON public.company_whatsapp_cloud (phone_number_id);

ALTER TABLE public.company_whatsapp_cloud ENABLE ROW LEVEL SECURITY;

-- Owners and managers manage their company's WhatsApp Cloud connection
CREATE POLICY "company_whatsapp_cloud_select_managers"
  ON public.company_whatsapp_cloud
  FOR SELECT
  TO authenticated
  USING (public.has_company_role(company_id, 'manager'));

CREATE POLICY "company_whatsapp_cloud_insert_managers"
  ON public.company_whatsapp_cloud
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_company_role(company_id, 'manager'));

CREATE POLICY "company_whatsapp_cloud_update_managers"
  ON public.company_whatsapp_cloud
  FOR UPDATE
  TO authenticated
  USING (public.has_company_role(company_id, 'manager'))
  WITH CHECK (public.has_company_role(company_id, 'manager'));

CREATE POLICY "company_whatsapp_cloud_delete_managers"
  ON public.company_whatsapp_cloud
  FOR DELETE
  TO authenticated
  USING (public.has_company_role(company_id, 'manager'));

-- Platform admins can view all rows for support
CREATE POLICY "company_whatsapp_cloud_admin_select"
  ON public.company_whatsapp_cloud
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Updated-at trigger
CREATE TRIGGER update_company_whatsapp_cloud_updated_at
  BEFORE UPDATE ON public.company_whatsapp_cloud
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Provider switch on companies — defaults to twilio so nothing changes for existing rows
ALTER TABLE public.companies
  ADD COLUMN whatsapp_provider TEXT NOT NULL DEFAULT 'twilio'
  CHECK (whatsapp_provider IN ('twilio', 'meta_cloud'));

CREATE INDEX idx_companies_whatsapp_provider ON public.companies (whatsapp_provider);