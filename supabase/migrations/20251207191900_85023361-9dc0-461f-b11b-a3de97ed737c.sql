-- Create ai_error_logs table for tracking AI mistakes
CREATE TABLE public.ai_error_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  error_type TEXT NOT NULL DEFAULT 'other',
  severity TEXT NOT NULL DEFAULT 'medium',
  original_message TEXT NOT NULL,
  ai_response TEXT NOT NULL,
  expected_response TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  fix_applied TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create ai_playground_sessions table for testing sessions
CREATE TABLE public.ai_playground_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  mode TEXT NOT NULL DEFAULT 'customer',
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ai_error_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_playground_sessions ENABLE ROW LEVEL SECURITY;

-- RLS policies for ai_error_logs
CREATE POLICY "Users can view their company error logs"
  ON public.ai_error_logs FOR SELECT
  USING (company_id IN (SELECT users.company_id FROM users WHERE users.id = auth.uid()));

CREATE POLICY "Users can insert error logs for their company"
  ON public.ai_error_logs FOR INSERT
  WITH CHECK (company_id IN (SELECT users.company_id FROM users WHERE users.id = auth.uid()));

CREATE POLICY "Users can update their company error logs"
  ON public.ai_error_logs FOR UPDATE
  USING (company_id IN (SELECT users.company_id FROM users WHERE users.id = auth.uid()));

CREATE POLICY "Users can delete their company error logs"
  ON public.ai_error_logs FOR DELETE
  USING (company_id IN (SELECT users.company_id FROM users WHERE users.id = auth.uid()));

CREATE POLICY "Admins can manage all error logs"
  ON public.ai_error_logs FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- RLS policies for ai_playground_sessions
CREATE POLICY "Users can view their company playground sessions"
  ON public.ai_playground_sessions FOR SELECT
  USING (company_id IN (SELECT users.company_id FROM users WHERE users.id = auth.uid()));

CREATE POLICY "Users can insert playground sessions for their company"
  ON public.ai_playground_sessions FOR INSERT
  WITH CHECK (company_id IN (SELECT users.company_id FROM users WHERE users.id = auth.uid()));

CREATE POLICY "Users can update their company playground sessions"
  ON public.ai_playground_sessions FOR UPDATE
  USING (company_id IN (SELECT users.company_id FROM users WHERE users.id = auth.uid()));

CREATE POLICY "Users can delete their company playground sessions"
  ON public.ai_playground_sessions FOR DELETE
  USING (company_id IN (SELECT users.company_id FROM users WHERE users.id = auth.uid()));

CREATE POLICY "Admins can manage all playground sessions"
  ON public.ai_playground_sessions FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- Add trigger for updated_at
CREATE TRIGGER update_ai_error_logs_updated_at
  BEFORE UPDATE ON public.ai_error_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();