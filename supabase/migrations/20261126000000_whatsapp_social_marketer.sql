-- Omanut WhatsApp-First AI Social Media Marketer SaaS (Phases 1 + 2)
-- Strictly additive migration: zero changes to existing tenant workflows or RLS policies.

-- 1. Preset subscription plans (always overridable per-subscriber for manual MoMo deals)
CREATE TABLE IF NOT EXISTS public.marketer_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  currency text NOT NULL DEFAULT 'ZMW',
  default_setup_fee numeric NOT NULL DEFAULT 0,
  default_monthly_fee numeric NOT NULL DEFAULT 0,
  monthly_posts_limit int NOT NULL DEFAULT 16,
  monthly_images_limit int NOT NULL DEFAULT 15,
  monthly_videos_limit int NOT NULL DEFAULT 4,
  vault_storage_mb int NOT NULL DEFAULT 1024,
  max_brands int NOT NULL DEFAULT 1,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.marketer_plans (
  slug, name, description, currency,
  default_setup_fee, default_monthly_fee,
  monthly_posts_limit, monthly_images_limit, monthly_videos_limit,
  vault_storage_mb, max_brands, features
)
VALUES
  (
    'starter',
    'Starter Marketer',
    'For solo business owners getting consistent on Facebook & Instagram',
    'ZMW',
    750, 500,
    12, 10, 2,
    1024, 1,
    '{"platforms": ["facebook", "instagram"], "weekly_kickoff": true, "friday_digest": true}'::jsonb
  ),
  (
    'growth',
    'Growth Marketer',
    'For growing brands using Reels, Vault curation & weekly AI batches',
    'ZMW',
    1200, 1000,
    24, 25, 6,
    3072, 1,
    '{"platforms": ["facebook", "instagram", "tiktok", "linkedin"], "weekly_kickoff": true, "friday_digest": true, "autopilot": true}'::jsonb
  ),
  (
    'pro',
    'Pro / Multi-Brand',
    'For established businesses & multi-branch brands needing full volume',
    'ZMW',
    2000, 2000,
    60, 60, 15,
    10240, 3,
    '{"platforms": ["facebook", "instagram", "tiktok", "linkedin"], "weekly_kickoff": true, "friday_digest": true, "autopilot": true, "priority_video": true}'::jsonb
  )
ON CONFLICT (slug) DO NOTHING;

-- 2. Per-company SaaS subscription & billing state
CREATE TABLE IF NOT EXISTS public.marketer_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid UNIQUE NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.marketer_plans(id) ON DELETE SET NULL,
  primary_whatsapp_phone text NOT NULL,
  contact_name text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('setup_pending', 'active', 'grace_period', 'paused', 'cancelled')),
  currency text NOT NULL DEFAULT 'ZMW',
  setup_fee_amount numeric NOT NULL DEFAULT 0,
  setup_fee_paid boolean NOT NULL DEFAULT false,
  setup_fee_paid_at timestamptz,
  monthly_fee_amount numeric NOT NULL DEFAULT 0,
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  grace_until timestamptz,
  monthly_posts_limit int NOT NULL DEFAULT 16,
  monthly_images_limit int NOT NULL DEFAULT 15,
  monthly_videos_limit int NOT NULL DEFAULT 4,
  usage_posts_used int NOT NULL DEFAULT 0,
  usage_images_used int NOT NULL DEFAULT 0,
  usage_videos_used int NOT NULL DEFAULT 0,
  usage_reset_at timestamptz NOT NULL DEFAULT now(),
  autopilot_level text NOT NULL DEFAULT 'copilot' CHECK (autopilot_level IN ('copilot', 'weekly_batch', 'full_autopilot')),
  weekly_kickoff_day int NOT NULL DEFAULT 1,
  weekly_kickoff_hour int NOT NULL DEFAULT 8,
  notes text,
  provisioned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketer_subscriptions_phone
  ON public.marketer_subscriptions (primary_whatsapp_phone);
CREATE INDEX IF NOT EXISTS idx_marketer_subscriptions_status
  ON public.marketer_subscriptions (status, current_period_end);

-- 3. Manual & gateway payment ledger
CREATE TABLE IF NOT EXISTS public.marketer_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.marketer_subscriptions(id) ON DELETE CASCADE,
  payment_type text NOT NULL CHECK (payment_type IN ('setup_fee', 'monthly_renewal', 'setup_and_first_month', 'topup', 'other')),
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'ZMW',
  provider text NOT NULL DEFAULT 'manual_momo' CHECK (provider IN ('manual_momo', 'cash', 'bank_transfer', 'lenco_momo', 'lenco_card')),
  reference_code text,
  notes text,
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('pending', 'paid', 'refunded')),
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketer_payments_company
  ON public.marketer_payments (company_id, paid_at DESC);

-- 4. Per-phone state on the single shared Omanut Marketer WhatsApp number
CREATE TABLE IF NOT EXISTS public.marketer_sessions (
  phone text PRIMARY KEY,
  active_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  mode text NOT NULL DEFAULT 'marketer' CHECK (mode IN ('marketer', 'brand_switch', 'pitch_demo')),
  pending_draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_a2ui_session_id uuid,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Isolated WhatsApp Social Marketer conversation log
CREATE TABLE IF NOT EXISTS public.marketer_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  phone text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  media_urls text[] NOT NULL DEFAULT '{}',
  tool_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketer_messages_company_phone
  ON public.marketer_messages (company_id, phone, created_at DESC);

-- 6. Dynamic ephemeral mobile A2UI Studio sessions (/m/:token)
CREATE TABLE IF NOT EXISTS public.a2ui_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  phone text NOT NULL,
  token_hash text UNIQUE NOT NULL,
  surface_type text NOT NULL CHECK (
    surface_type IN (
      'vault_uploader',
      'vault_prioritizer',
      'calendar_grid',
      'creative_studio',
      'connect_hub',
      'brand_dna',
      'onboarding_hub'
    )
  ),
  ui_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_payload jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'submitted', 'expired')),
  expires_at timestamptz NOT NULL,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_a2ui_sessions_company
  ON public.a2ui_sessions (company_id, created_at DESC);

-- 7. Additive Content Vault columns on company_media
ALTER TABLE public.company_media
  ADD COLUMN IF NOT EXISTS vault_status text NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS source_channel text NOT NULL DEFAULT 'dashboard',
  ADD COLUMN IF NOT EXISTS quality_score int,
  ADD COLUMN IF NOT EXISTS ai_hook_suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS recommended_format text,
  ADD COLUMN IF NOT EXISTS times_posted int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS priority_rank int;

DO $$ BEGIN
  ALTER TABLE public.company_media
    ADD CONSTRAINT company_media_vault_status_chk
    CHECK (vault_status IN ('raw', 'ready', 'scheduled', 'posted', 'evergreen', 'archived'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.company_media
    ADD CONSTRAINT company_media_source_channel_chk
    CHECK (source_channel IN ('dashboard', 'whatsapp', 'a2ui_uploader', 'ai_generated'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 8. Additive shared-hub delivery routing columns on video_generation_jobs
ALTER TABLE public.video_generation_jobs
  ADD COLUMN IF NOT EXISTS delivery_channel text,
  ADD COLUMN IF NOT EXISTS delivery_from_number text;

-- 9. Updated-at triggers for new mutable tables
DROP TRIGGER IF EXISTS trg_marketer_subscriptions_updated_at ON public.marketer_subscriptions;
CREATE TRIGGER trg_marketer_subscriptions_updated_at
  BEFORE UPDATE ON public.marketer_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_marketer_sessions_updated_at ON public.marketer_sessions;
CREATE TRIGGER trg_marketer_sessions_updated_at
  BEFORE UPDATE ON public.marketer_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 10. Explicit GRANTS & RLS on all new tables
ALTER TABLE public.marketer_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketer_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketer_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketer_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketer_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.a2ui_sessions ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.marketer_plans TO authenticated;
GRANT SELECT ON public.marketer_subscriptions TO authenticated;
GRANT SELECT ON public.marketer_payments TO authenticated;
GRANT SELECT ON public.marketer_messages TO authenticated;

GRANT ALL ON public.marketer_plans TO service_role;
GRANT ALL ON public.marketer_subscriptions TO service_role;
GRANT ALL ON public.marketer_payments TO service_role;
GRANT ALL ON public.marketer_sessions TO service_role;
GRANT ALL ON public.marketer_messages TO service_role;
GRANT ALL ON public.a2ui_sessions TO service_role;

DO $$ BEGIN
  CREATE POLICY "Authenticated read active marketer plans"
    ON public.marketer_plans FOR SELECT TO authenticated
    USING (is_active = true OR public.has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins manage marketer plans"
    ON public.marketer_plans FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Company members and admins view marketer subscriptions"
    ON public.marketer_subscriptions FOR SELECT TO authenticated
    USING (public.user_has_company_access_v2(company_id) OR public.has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins manage marketer subscriptions"
    ON public.marketer_subscriptions FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Company members and admins view marketer payments"
    ON public.marketer_payments FOR SELECT TO authenticated
    USING (public.user_has_company_access_v2(company_id) OR public.has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins manage marketer payments"
    ON public.marketer_payments FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins manage marketer sessions"
    ON public.marketer_sessions FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Company members and admins view marketer messages"
    ON public.marketer_messages FOR SELECT TO authenticated
    USING (public.user_has_company_access_v2(company_id) OR public.has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins manage marketer messages"
    ON public.marketer_messages FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins manage a2ui sessions"
    ON public.a2ui_sessions FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
