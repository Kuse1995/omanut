-- 1. Add error_code column to ai_error_logs for structured taxonomy
ALTER TABLE public.ai_error_logs
  ADD COLUMN IF NOT EXISTS error_code TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_error_logs_error_code
  ON public.ai_error_logs(error_code) WHERE error_code IS NOT NULL;

-- 2. BMS health check log — periodic ping results per company
CREATE TABLE IF NOT EXISTS public.bms_health_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL,           -- 'healthy' | 'degraded' | 'down'
  latency_ms INTEGER,
  error_code TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_bms_health_log_company_time
  ON public.bms_health_log(company_id, checked_at DESC);

ALTER TABLE public.bms_health_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can view their BMS health"
  ON public.bms_health_log FOR SELECT
  TO authenticated
  USING (public.user_has_company_access_v2(company_id) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role manages BMS health"
  ON public.bms_health_log FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 3. BMS write log — idempotency cache for write operations
CREATE TABLE IF NOT EXISTS public.bms_write_log (
  idempotency_key TEXT PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id UUID,
  intent TEXT NOT NULL,
  params JSONB,
  result JSONB,
  status TEXT NOT NULL DEFAULT 'in_flight', -- 'in_flight' | 'success' | 'failure'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_bms_write_log_company_time
  ON public.bms_write_log(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bms_write_log_expires
  ON public.bms_write_log(expires_at);

ALTER TABLE public.bms_write_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can view their BMS writes"
  ON public.bms_write_log FOR SELECT
  TO authenticated
  USING (public.user_has_company_access_v2(company_id) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role manages BMS write log"
  ON public.bms_write_log FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 4. BMS call history — every BMS call for diagnostics
CREATE TABLE IF NOT EXISTS public.bms_call_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id UUID,
  intent TEXT NOT NULL,
  params JSONB,
  success BOOLEAN NOT NULL,
  error_code TEXT,
  error_message TEXT,
  latency_ms INTEGER,
  attempts INTEGER DEFAULT 1,
  response_excerpt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bms_call_log_company_time
  ON public.bms_call_log(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bms_call_log_conversation
  ON public.bms_call_log(conversation_id, created_at DESC) WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bms_call_log_error_code
  ON public.bms_call_log(error_code, created_at DESC) WHERE error_code IS NOT NULL;

ALTER TABLE public.bms_call_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can view their BMS calls"
  ON public.bms_call_log FOR SELECT
  TO authenticated
  USING (public.user_has_company_access_v2(company_id) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role manages BMS call log"
  ON public.bms_call_log FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');