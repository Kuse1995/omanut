
-- Enums
DO $$ BEGIN
  CREATE TYPE public.subscription_tier_t AS ENUM ('hustler','starter','pro','enterprise');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.asset_validation_status_t AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.kb_sync_status_t AS ENUM ('pending','syncing','synced','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.wizard_state_t AS ENUM ('not_started','in_progress','meta_pending_verification','billing_pending','complete');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.meta_connection_state_t AS ENUM (
    'meta_oauth_initiated',
    'meta_domain_verification_required',
    'meta_business_verification_pending',
    'meta_whatsapp_number_pending',
    'meta_connected',
    'meta_disconnected'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.approval_status_t AS ENUM ('pending','approved','rejected','sent','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- companies
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS is_live boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS subscription_tier public.subscription_tier_t NOT NULL DEFAULT 'starter',
  ADD COLUMN IF NOT EXISTS image_gen_unlocked boolean NOT NULL DEFAULT false;

-- backfill existing companies to live (they're already in production)
UPDATE public.companies SET is_live = true WHERE created_at < now();

-- company_ai_overrides
ALTER TABLE public.company_ai_overrides
  ADD COLUMN IF NOT EXISTS tone_voice_guide text,
  ADD COLUMN IF NOT EXISTS escalation_triggers text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS persona_version integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.bump_persona_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.persona_version := COALESCE(OLD.persona_version, 1) + 1;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bump_persona_version ON public.company_ai_overrides;
CREATE TRIGGER trg_bump_persona_version
  BEFORE UPDATE ON public.company_ai_overrides
  FOR EACH ROW EXECUTE FUNCTION public.bump_persona_version();

-- conversations
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS paused_reason text,
  ADD COLUMN IF NOT EXISTS paused_until timestamptz;

-- company_media
ALTER TABLE public.company_media
  ADD COLUMN IF NOT EXISTS asset_validation_status public.asset_validation_status_t NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS validation_reason text;

-- existing media: assume already-uploaded items are approved (no mass re-review)
UPDATE public.company_media SET asset_validation_status = 'approved' WHERE created_at < now() AND asset_validation_status = 'pending';

-- backfill image_gen_unlocked based on existing approved media
UPDATE public.companies c
SET image_gen_unlocked = true
WHERE (
  SELECT count(*) FROM public.company_media m
  WHERE m.company_id = c.id AND m.asset_validation_status = 'approved'
) >= 3;

-- company_documents
ALTER TABLE public.company_documents
  ADD COLUMN IF NOT EXISTS kb_sync_status public.kb_sync_status_t NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS kb_sync_error text,
  ADD COLUMN IF NOT EXISTS kb_synced_at timestamptz;

-- backfill: existing docs with embeddings considered synced
UPDATE public.company_documents
SET kb_sync_status = 'synced', kb_synced_at = COALESCE(kb_synced_at, updated_at, created_at)
WHERE embedding IS NOT NULL AND kb_sync_status = 'pending';

-- match_documents: filter to synced only
CREATE OR REPLACE FUNCTION public.match_documents(
  query_embedding vector,
  match_company_id uuid,
  match_threshold double precision DEFAULT 0.3,
  match_count integer DEFAULT 3
)
RETURNS TABLE(id uuid, filename text, parsed_content text, similarity double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT d.id, d.filename, d.parsed_content,
    1 - (d.embedding <=> query_embedding) AS similarity
  FROM public.company_documents d
  WHERE d.company_id = match_company_id
    AND d.embedding IS NOT NULL
    AND d.kb_sync_status = 'synced'
    AND 1 - (d.embedding <=> query_embedding) > match_threshold
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- meta_credentials
ALTER TABLE public.meta_credentials
  ADD COLUMN IF NOT EXISTS connection_state public.meta_connection_state_t NOT NULL DEFAULT 'meta_connected';

-- company_onboarding_drafts (new)
CREATE TABLE IF NOT EXISTS public.company_onboarding_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  wizard_state public.wizard_state_t NOT NULL DEFAULT 'not_started',
  current_step integer NOT NULL DEFAULT 0,
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  step_errors jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.company_onboarding_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own draft" ON public.company_onboarding_drafts;
CREATE POLICY "own draft" ON public.company_onboarding_drafts
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS idx_onb_drafts_user ON public.company_onboarding_drafts(user_id);

-- test_outbound_log (new)
CREATE TABLE IF NOT EXISTS public.test_outbound_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  channel text NOT NULL,
  recipient text,
  payload jsonb NOT NULL,
  reason text NOT NULL DEFAULT 'sandbox',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.test_outbound_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company members read" ON public.test_outbound_log;
CREATE POLICY "company members read" ON public.test_outbound_log
  FOR SELECT USING (public.user_has_company_access_v2(company_id) OR public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "service insert" ON public.test_outbound_log;
CREATE POLICY "service insert" ON public.test_outbound_log
  FOR INSERT WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_test_outbound_company_time ON public.test_outbound_log(company_id, created_at DESC);

-- system_metrics (new)
CREATE TABLE IF NOT EXISTS public.system_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  metric text NOT NULL,
  value double precision NOT NULL,
  tags jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.system_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read metrics" ON public.system_metrics;
CREATE POLICY "admins read metrics" ON public.system_metrics
  FOR SELECT USING (public.has_role(auth.uid(),'admin') OR (company_id IS NOT NULL AND public.user_has_company_access_v2(company_id)));
DROP POLICY IF EXISTS "service insert metrics" ON public.system_metrics;
CREATE POLICY "service insert metrics" ON public.system_metrics
  FOR INSERT WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_system_metrics_lookup ON public.system_metrics(metric, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_metrics_company ON public.system_metrics(company_id, recorded_at DESC);

-- outbound_approval_queue (new)
CREATE TABLE IF NOT EXISTS public.outbound_approval_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id uuid,
  channel text NOT NULL,
  recipient text,
  payload jsonb NOT NULL,
  reason text,
  status public.approval_status_t NOT NULL DEFAULT 'pending',
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.outbound_approval_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "managers manage queue" ON public.outbound_approval_queue;
CREATE POLICY "managers manage queue" ON public.outbound_approval_queue
  FOR ALL USING (public.has_company_role(company_id,'manager') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_company_role(company_id,'manager') OR public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "service insert queue" ON public.outbound_approval_queue;
CREATE POLICY "service insert queue" ON public.outbound_approval_queue
  FOR INSERT WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_approval_queue_pending ON public.outbound_approval_queue(company_id, status, created_at DESC);
