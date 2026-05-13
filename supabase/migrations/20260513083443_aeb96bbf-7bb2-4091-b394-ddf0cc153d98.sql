CREATE TABLE IF NOT EXISTS public.swarm_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  channel text NOT NULL,
  conversation_id uuid,
  input_excerpt text,
  final_text text,
  final_score int,
  retries int DEFAULT 0,
  escalated boolean DEFAULT false,
  stage_timings jsonb DEFAULT '{}'::jsonb,
  critique_history jsonb DEFAULT '[]'::jsonb,
  models_used jsonb DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_swarm_runs_company_created ON public.swarm_runs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_swarm_runs_conv ON public.swarm_runs(conversation_id) WHERE conversation_id IS NOT NULL;

ALTER TABLE public.swarm_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can read their swarm runs"
  ON public.swarm_runs FOR SELECT
  USING (public.user_has_company_access_v2(company_id) OR public.has_role(auth.uid(), 'admin'));
