-- ============================================
-- Security Events Table for Audit Logging
-- ============================================

CREATE TABLE public.security_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT NOT NULL, -- tenant_violation, auth_failure, suspicious_access, etc.
  severity TEXT NOT NULL DEFAULT 'warning', -- info, warning, error, critical
  company_id UUID REFERENCES public.companies(id), -- May be null for cross-tenant violations
  user_id UUID REFERENCES auth.users(id), -- May be null for system events
  source TEXT NOT NULL, -- edge function name or component
  message TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

-- Only platform admins can view security events
CREATE POLICY "Platform admins can view security events"
ON public.security_events
FOR SELECT
USING (has_role(auth.uid(), 'admin'));

-- System can insert security events (edge functions use service role)
CREATE POLICY "System can insert security events"
ON public.security_events
FOR INSERT
WITH CHECK (true);

-- Create indexes for efficient querying
CREATE INDEX idx_security_events_type ON public.security_events(event_type);
CREATE INDEX idx_security_events_severity ON public.security_events(severity);
CREATE INDEX idx_security_events_company_id ON public.security_events(company_id);
CREATE INDEX idx_security_events_created_at ON public.security_events(created_at DESC);