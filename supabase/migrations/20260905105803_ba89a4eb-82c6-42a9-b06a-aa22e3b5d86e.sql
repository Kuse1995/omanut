-- Growth Engine — full-funnel autonomous marketing.
CREATE TABLE IF NOT EXISTS public.campaigns (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  objective text,
  brief text,
  playbook text,
  target_platform text NOT NULL DEFAULT 'both',
  status text NOT NULL DEFAULT 'draft',
  scheduled_time timestamptz,
  target_audience text,
  funnel_stage text,
  winner_variant_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO authenticated;
GRANT ALL ON public.campaigns TO service_role;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.campaign_variants (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  label text NOT NULL,
  content text NOT NULL,
  hook text,
  image_url text,
  video_url text,
  channel text NOT NULL DEFAULT 'facebook',
  status text NOT NULL DEFAULT 'draft',
  post_id uuid REFERENCES public.scheduled_posts(id) ON DELETE SET NULL,
  is_winner boolean NOT NULL DEFAULT false,
  metrics jsonb DEFAULT '{}'::jsonb,
  score numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_variants TO authenticated;
GRANT ALL ON public.campaign_variants TO service_role;
ALTER TABLE public.campaign_variants ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS campaign_variants_campaign_idx ON public.campaign_variants(campaign_id);

CREATE TABLE IF NOT EXISTS public.brand_kits (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  logo_url text,
  colors jsonb DEFAULT '{}'::jsonb,
  tone text,
  fonts jsonb DEFAULT '{}'::jsonb,
  no_go_phrases text,
  guidelines text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_kits TO authenticated;
GRANT ALL ON public.brand_kits TO service_role;
ALTER TABLE public.brand_kits ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.nurture_sequences (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  trigger_type text NOT NULL,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nurture_sequences TO authenticated;
GRANT ALL ON public.nurture_sequences TO service_role;
ALTER TABLE public.nurture_sequences ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.competitor_targets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  platform text NOT NULL DEFAULT 'facebook',
  identifier text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.competitor_targets TO authenticated;
GRANT ALL ON public.competitor_targets TO service_role;
ALTER TABLE public.competitor_targets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.growth_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.growth_snapshots TO authenticated;
GRANT ALL ON public.growth_snapshots TO service_role;
ALTER TABLE public.growth_snapshots ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS growth_snapshots_company_date_idx ON public.growth_snapshots(company_id, snapshot_date);

DO $$ BEGIN
CREATE POLICY "company members_view_campaigns" ON public.campaigns FOR SELECT TO authenticated USING (user_has_company_access_v2(company_id));
CREATE POLICY "contributors_create_campaigns" ON public.campaigns FOR INSERT TO authenticated WITH CHECK (has_company_role(company_id, 'contributor'::company_role));
CREATE POLICY "contributors_update_campaigns" ON public.campaigns FOR UPDATE TO authenticated USING (has_company_role(company_id, 'contributor'::company_role));
CREATE POLICY "owners_delete_campaigns" ON public.campaigns FOR DELETE TO authenticated USING (has_company_role(company_id, 'owner'::company_role));

CREATE POLICY "company members_view_variants" ON public.campaign_variants FOR SELECT TO authenticated USING (user_has_company_access_v2(company_id));
CREATE POLICY "contributors_create_variants" ON public.campaign_variants FOR INSERT TO authenticated WITH CHECK (has_company_role(company_id, 'contributor'::company_role));
CREATE POLICY "contributors_update_variants" ON public.campaign_variants FOR UPDATE TO authenticated USING (has_company_role(company_id, 'contributor'::company_role));
CREATE POLICY "owners_delete_variants" ON public.campaign_variants FOR DELETE TO authenticated USING (has_company_role(company_id, 'owner'::company_role));

CREATE POLICY "company members_view_brand_kits" ON public.brand_kits FOR SELECT TO authenticated USING (user_has_company_access_v2(company_id));
CREATE POLICY "contributors_write_brand_kits" ON public.brand_kits FOR INSERT TO authenticated WITH CHECK (has_company_role(company_id, 'contributor'::company_role));
CREATE POLICY "contributors_update_brand_kits" ON public.brand_kits FOR UPDATE TO authenticated USING (has_company_role(company_id, 'contributor'::company_role));

CREATE POLICY "company members_view_nurture" ON public.nurture_sequences FOR SELECT TO authenticated USING (user_has_company_access_v2(company_id));
CREATE POLICY "contributors_write_nurture" ON public.nurture_sequences FOR INSERT TO authenticated WITH CHECK (has_company_role(company_id, 'contributor'::company_role));
CREATE POLICY "contributors_update_nurture" ON public.nurture_sequences FOR UPDATE TO authenticated USING (has_company_role(company_id, 'contributor'::company_role));

CREATE POLICY "company members_view_competitors" ON public.competitor_targets FOR SELECT TO authenticated USING (user_has_company_access_v2(company_id));
CREATE POLICY "contributors_write_competitors" ON public.competitor_targets FOR INSERT TO authenticated WITH CHECK (has_company_role(company_id, 'contributor'::company_role));
CREATE POLICY "contributors_update_competitors" ON public.competitor_targets FOR UPDATE TO authenticated USING (has_company_role(company_id, 'contributor'::company_role));

CREATE POLICY "company members_view_growth" ON public.growth_snapshots FOR SELECT TO authenticated USING (user_has_company_access_v2(company_id));
CREATE POLICY "service_insert_growth" ON public.growth_snapshots FOR INSERT TO authenticated WITH CHECK (has_company_role(company_id, 'contributor'::company_role));

CREATE POLICY "admins_all_campaigns" ON public.campaigns FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "admins_all_variants" ON public.campaign_variants FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "admins_all_brand_kits" ON public.brand_kits FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "admins_all_nurture" ON public.nurture_sequences FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "admins_all_competitors" ON public.competitor_targets FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "admins_all_growth" ON public.growth_snapshots FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;