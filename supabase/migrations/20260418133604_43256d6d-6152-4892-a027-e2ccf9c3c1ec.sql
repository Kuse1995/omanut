-- 1. Cross-tenant audit table
CREATE TABLE public.cross_tenant_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL,
  caller_scope TEXT,
  asserted_company_id UUID,
  resolved_company_id UUID,
  customer_phone TEXT,
  decision TEXT NOT NULL,
  reason TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_cross_tenant_audit_created_at ON public.cross_tenant_audit(created_at DESC);
CREATE INDEX idx_cross_tenant_audit_decision ON public.cross_tenant_audit(decision);
CREATE INDEX idx_cross_tenant_audit_asserted_company ON public.cross_tenant_audit(asserted_company_id);

ALTER TABLE public.cross_tenant_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can view audit"
  ON public.cross_tenant_audit
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role full access on audit"
  ON public.cross_tenant_audit
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. Archive leaked conversations: Omanut customer attached to non-Omanut companies.
WITH omanut AS (
  SELECT id FROM public.companies WHERE name ILIKE '%omanut%' LIMIT 1
),
leaked AS (
  SELECT c.id
  FROM public.conversations c
  WHERE c.customer_name ILIKE '%OMANUT%'
    AND c.company_id IS DISTINCT FROM (SELECT id FROM omanut)
)
UPDATE public.conversations
SET 
  status = 'archived',
  quality_flag = 'cross_tenant_leak_cleanup'
WHERE id IN (SELECT id FROM leaked);

-- 3. Log the cleanup
INSERT INTO public.cross_tenant_audit (source, decision, reason, details)
SELECT 
  'migration_cleanup',
  'archived',
  'cross_tenant_leak_cleanup',
  jsonb_build_object(
    'archived_count', COUNT(*),
    'conversation_ids', jsonb_agg(id)
  )
FROM public.conversations
WHERE quality_flag = 'cross_tenant_leak_cleanup';