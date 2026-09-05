-- Growth Engine — full-funnel autonomous marketing.
-- New tables backing the Campaign Engine, Brand Kit, nurture sequences,
-- competitor watch, and the Growth Hub scoreboard.
-- Forward-only, RLS-locked to company members (mirrors scheduled_posts).

-- ── Campaigns (a campaign = one objective, many A/B variants) ─────────────
CREATE TABLE IF NOT EXISTS public.campaigns (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  objective text,                    -- awareness / engagement / leads / sales
  brief text,                        -- owner's one-line ask
  playbook text,                     -- flash_sale | launch | restock | seasonal | new_branch | custom
  target_platform text NOT NULL DEFAULT 'both',  -- facebook | instagram | both
  status text NOT NULL DEFAULT 'draft',          -- draft | scheduled | running | paused | completed
  scheduled_time timestamptz,
  target_audience text,              -- optional audience hint
  funnel_stage text,                 -- top / middle / bottom
  winner_variant_id uuid,            -- promoted winner
  metadata jsonb DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

-- ── Campaign variants (the A/B creatives under a campaign) ───────────────
CREATE TABLE IF NOT EXISTS public.campaign_variants (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  label text NOT NULL,               -- Variant A / Variant B / ...
  content text NOT NULL,             -- caption / copy
  hook text,                         -- first line (hook)
  image_url text,
  video_url text,
  channel text NOT NULL DEFAULT 'facebook',  -- facebook | instagram
  status text NOT NULL DEFAULT 'draft',      -- draft | scheduled | published | failed
  post_id uuid REFERENCES public.scheduled_posts(id) ON DELETE SET NULL,
  is_winner boolean NOT NULL DEFAULT false,
  metrics jsonb DEFAULT '{}'::jsonb, -- impressions, reach, likes, comments, clicks, leads, revenue
  score numeric,                     -- computed composite score
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.campaign_variants ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS campaign_variants_campaign_idx ON public.campaign_variants(campaign_id);

-- ── Brand Kit (on-brand guardrail across posts + video) ───────────────────
CREATE TABLE IF NOT EXISTS public.brand_kits (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  logo_url text,
  colors jsonb DEFAULT '{}'::jsonb,       -- { primary, secondary, accent }
  tone text,                              -- e.g. "Warm, professional, local"
  fonts jsonb DEFAULT '{}'::jsonb,        -- { heading, body }
  no_go_phrases text,                     -- comma-separated banned words
  guidelines text,                        -- free-text brand rules
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.brand_kits ENABLE ROW LEVEL SECURITY;

-- ── Nurture sequences (proactive follow-ups) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.nurture_sequences (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,                 -- "Win back", "Abandoned enquiry"
  trigger_type text NOT NULL,         -- abandoned_enquiry | win_back | birthday | post_purchase | custom
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{ delay_days, channel, message, media_url }]
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.nurture_sequences ENABLE ROW LEVEL SECURITY;

-- ── Competitor / market watch targets ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.competitor_targets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  platform text NOT NULL DEFAULT 'facebook',   -- facebook | instagram | page | hashtag
  identifier text NOT NULL,            -- page id / username / hashtag
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.competitor_targets ENABLE ROW LEVEL SECURITY;

-- ── Growth snapshots (daily/pull-based scoreboard points) ─────────────────
CREATE TABLE IF NOT EXISTS public.growth_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.growth_snapshots ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS growth_snapshots_company_date_idx ON public.growth_snapshots(company_id, snapshot_date);

-- ── RLS: all company-scoped, mirroring scheduled_posts ────────────────────
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

-- Platform admins full access
CREATE POLICY "admins_all_campaigns" ON public.campaigns FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "admins_all_variants" ON public.campaign_variants FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "admins_all_brand_kits" ON public.brand_kits FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "admins_all_nurture" ON public.nurture_sequences FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "admins_all_competitors" ON public.competitor_targets FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "admins_all_growth" ON public.growth_snapshots FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));