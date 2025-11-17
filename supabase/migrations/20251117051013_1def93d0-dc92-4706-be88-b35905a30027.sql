-- Create table to track which conversation the takeover number is responding to
CREATE TABLE IF NOT EXISTS public.takeover_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  takeover_phone text NOT NULL,
  selected_conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '2 hours'),
  UNIQUE(company_id, takeover_phone)
);

-- Index for fast lookups
CREATE INDEX idx_takeover_sessions_lookup ON public.takeover_sessions(company_id, takeover_phone);
CREATE INDEX idx_takeover_sessions_expires ON public.takeover_sessions(expires_at);

-- Auto-update timestamp trigger
CREATE TRIGGER update_takeover_sessions_updated_at
  BEFORE UPDATE ON public.takeover_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.takeover_sessions ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their company takeover sessions"
  ON public.takeover_sessions
  FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id 
      FROM public.users 
      WHERE id = auth.uid()
    )
  );

CREATE POLICY "System can manage takeover sessions"
  ON public.takeover_sessions
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.takeover_sessions IS 'Tracks which conversation the takeover number is currently responding to';
COMMENT ON COLUMN public.takeover_sessions.expires_at IS 'Session expires after 2 hours of inactivity';