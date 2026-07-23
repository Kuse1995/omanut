
CREATE TABLE public.rule_violations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  severity TEXT NOT NULL DEFAULT 'medium',
  rule_broken TEXT NOT NULL,
  explanation TEXT,
  offending_excerpt TEXT,
  assistant_content TEXT,
  model TEXT,
  auto_regenerated BOOLEAN NOT NULL DEFAULT false,
  reviewed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX rule_violations_company_created_idx ON public.rule_violations(company_id, created_at DESC);
CREATE INDEX rule_violations_conversation_idx ON public.rule_violations(conversation_id);
CREATE INDEX rule_violations_reviewed_idx ON public.rule_violations(company_id, reviewed) WHERE reviewed = false;

GRANT SELECT, UPDATE ON public.rule_violations TO authenticated;
GRANT ALL ON public.rule_violations TO service_role;

ALTER TABLE public.rule_violations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members view rule_violations"
  ON public.rule_violations FOR SELECT TO authenticated
  USING (user_has_company_access_v2(company_id) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Company managers can mark reviewed"
  ON public.rule_violations FOR UPDATE TO authenticated
  USING (can_manage_company_users(company_id) OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (can_manage_company_users(company_id) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role full access rule_violations"
  ON public.rule_violations FOR ALL
  USING (true) WITH CHECK (true);

-- Trigger: fire check-rule-adherence for every assistant message
CREATE OR REPLACE FUNCTION public.trigger_check_rule_adherence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role <> 'assistant' THEN RETURN NEW; END IF;
  IF NEW.content IS NULL OR length(trim(NEW.content)) < 3 THEN RETURN NEW; END IF;

  PERFORM net.http_post(
    url := 'https://dzheddvoiauevcayifev.supabase.co/functions/v1/check-rule-adherence',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object('message_id', NEW.id),
    timeout_milliseconds := 1500
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_assistant_message_check_rules
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.trigger_check_rule_adherence();
