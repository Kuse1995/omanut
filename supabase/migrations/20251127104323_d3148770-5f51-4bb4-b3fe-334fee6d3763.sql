-- Create onboarding sessions table to track WhatsApp onboarding progress
CREATE TABLE public.onboarding_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  current_step TEXT NOT NULL DEFAULT 'welcome',
  collected_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  research_data JSONB,
  created_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + INTERVAL '24 hours')
);

-- Create index on phone for faster lookups
CREATE INDEX idx_onboarding_sessions_phone ON public.onboarding_sessions(phone);

-- Create index on status
CREATE INDEX idx_onboarding_sessions_status ON public.onboarding_sessions(status);

-- Enable RLS
ALTER TABLE public.onboarding_sessions ENABLE ROW LEVEL SECURITY;

-- Admins can view all sessions
CREATE POLICY "Admins can view all onboarding sessions"
  ON public.onboarding_sessions
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

-- System can manage all sessions (for the edge function)
CREATE POLICY "System can manage onboarding sessions"
  ON public.onboarding_sessions
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Add trigger for updated_at
CREATE TRIGGER update_onboarding_sessions_updated_at
  BEFORE UPDATE ON public.onboarding_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();