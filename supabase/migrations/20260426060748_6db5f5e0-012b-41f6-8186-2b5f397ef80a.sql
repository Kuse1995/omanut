
-- 1. Add ad_account_id to meta_credentials
ALTER TABLE public.meta_credentials
  ADD COLUMN IF NOT EXISTS ad_account_id text;

-- 2. Helper: is current user an owner of the company?
CREATE OR REPLACE FUNCTION public.is_company_owner(_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_users
    WHERE user_id = auth.uid()
      AND company_id = _company_id
      AND role = 'owner'
  );
$$;

-- 3. Campaigns table
CREATE TABLE IF NOT EXISTS public.meta_ad_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  credential_id uuid NOT NULL REFERENCES public.meta_credentials(id) ON DELETE CASCADE,
  meta_campaign_id text,
  meta_adset_id text,
  meta_ad_id text,
  meta_creative_id text,
  name text NOT NULL,
  objective text NOT NULL,
  status text NOT NULL DEFAULT 'PAUSED',
  daily_budget_cents integer,
  lifetime_budget_cents integer,
  currency text NOT NULL DEFAULT 'USD',
  start_at timestamptz,
  end_at timestamptz,
  creative_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  targeting jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meta_ad_campaigns_company ON public.meta_ad_campaigns(company_id);
CREATE INDEX IF NOT EXISTS idx_meta_ad_campaigns_status ON public.meta_ad_campaigns(status);

ALTER TABLE public.meta_ad_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team can view campaigns"
  ON public.meta_ad_campaigns FOR SELECT
  USING (public.user_has_company_access_v2(company_id));

CREATE POLICY "owners can insert campaigns"
  ON public.meta_ad_campaigns FOR INSERT
  WITH CHECK (public.is_company_owner(company_id));

CREATE POLICY "owners can update campaigns"
  ON public.meta_ad_campaigns FOR UPDATE
  USING (public.is_company_owner(company_id));

CREATE POLICY "owners can delete campaigns"
  ON public.meta_ad_campaigns FOR DELETE
  USING (public.is_company_owner(company_id));

CREATE TRIGGER trg_meta_ad_campaigns_updated_at
  BEFORE UPDATE ON public.meta_ad_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Daily insights table
CREATE TABLE IF NOT EXISTS public.meta_ad_insights_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.meta_ad_campaigns(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  date date NOT NULL,
  spend_cents integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  reach integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  results integer NOT NULL DEFAULT 0,
  cost_per_result_cents integer,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, date)
);
CREATE INDEX IF NOT EXISTS idx_meta_ad_insights_company_date
  ON public.meta_ad_insights_daily(company_id, date DESC);

ALTER TABLE public.meta_ad_insights_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team can view insights"
  ON public.meta_ad_insights_daily FOR SELECT
  USING (public.user_has_company_access_v2(company_id));

-- 5. Audit log
CREATE TABLE IF NOT EXISTS public.meta_ad_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.meta_ad_campaigns(id) ON DELETE SET NULL,
  actor_user_id uuid,
  action text NOT NULL,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meta_ad_audit_company ON public.meta_ad_audit_log(company_id, created_at DESC);

ALTER TABLE public.meta_ad_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team can view audit log"
  ON public.meta_ad_audit_log FOR SELECT
  USING (public.user_has_company_access_v2(company_id));
