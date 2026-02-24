
-- Create demo_sessions table for demo mode
CREATE TABLE public.demo_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  phone text,
  demo_company_name text NOT NULL,
  researched_data jsonb DEFAULT '{}'::jsonb,
  custom_persona text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '24 hours')
);

-- Enable RLS
ALTER TABLE public.demo_sessions ENABLE ROW LEVEL SECURITY;

-- Platform admins can view
CREATE POLICY "Platform admins can view demo sessions"
  ON public.demo_sessions FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Service role / system can do everything (edge functions use service role)
CREATE POLICY "System can manage demo sessions"
  ON public.demo_sessions FOR ALL
  USING (true)
  WITH CHECK (true);

-- Index for quick lookup by company + status
CREATE INDEX idx_demo_sessions_company_status ON public.demo_sessions(company_id, status);
