-- Admin platform upgrades:
--   1. ai_regression_tests table for closing the AI quality loop (Errors/Violations -> Regression Tests)
--   2. Platform-admin RLS policies on operational tables (user_has_company_access_v2 only checks company_users)

CREATE TABLE IF NOT EXISTS public.ai_regression_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  prompt text NOT NULL,
  expected_behavior text,
  must_include text[] NOT NULL DEFAULT '{}',
  must_not_include text[] NOT NULL DEFAULT '{}',
  source_error_id uuid,
  source_violation_id uuid,
  last_run_at timestamptz,
  last_passed boolean,
  last_response text,
  last_model text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_regression_tests_company
  ON public.ai_regression_tests (company_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_ai_regression_tests_updated_at ON public.ai_regression_tests;
CREATE TRIGGER trg_ai_regression_tests_updated_at
  BEFORE UPDATE ON public.ai_regression_tests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_regression_tests TO authenticated;
GRANT ALL ON public.ai_regression_tests TO service_role;

ALTER TABLE public.ai_regression_tests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Company members and admins can view regression tests"
    ON public.ai_regression_tests
    FOR SELECT
    TO authenticated
    USING (
      public.user_has_company_access_v2(company_id)
      OR public.has_role(auth.uid(), 'admin'::app_role)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers and admins can insert regression tests"
    ON public.ai_regression_tests
    FOR INSERT
    TO authenticated
    WITH CHECK (
      public.has_company_role(company_id, 'manager'::company_role)
      OR public.has_role(auth.uid(), 'admin'::app_role)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers and admins can update regression tests"
    ON public.ai_regression_tests
    FOR UPDATE
    TO authenticated
    USING (
      public.has_company_role(company_id, 'manager'::company_role)
      OR public.has_role(auth.uid(), 'admin'::app_role)
    )
    WITH CHECK (
      public.has_company_role(company_id, 'manager'::company_role)
      OR public.has_role(auth.uid(), 'admin'::app_role)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers and admins can delete regression tests"
    ON public.ai_regression_tests
    FOR DELETE
    TO authenticated
    USING (
      public.has_company_role(company_id, 'manager'::company_role)
      OR public.has_role(auth.uid(), 'admin'::app_role)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Platform admin policies on operational tables
DO $$ BEGIN
  CREATE POLICY "Platform admins full access to video_generation_jobs"
    ON public.video_generation_jobs
    FOR ALL
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Platform admins full access to agent_spending_limits"
    ON public.agent_spending_limits
    FOR ALL
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Platform admins can view all inbound_events"
    ON public.inbound_events
    FOR SELECT
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Platform admins can view all bms_health_log"
    ON public.bms_health_log
    FOR SELECT
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
