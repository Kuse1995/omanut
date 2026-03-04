
CREATE TABLE public.meta_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_id text NOT NULL,
  access_token text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('facebook', 'instagram')),
  ai_system_prompt text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.meta_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own meta credentials" ON public.meta_credentials
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can insert own meta credentials" ON public.meta_credentials
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own meta credentials" ON public.meta_credentials
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can delete own meta credentials" ON public.meta_credentials
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Admins full access to meta credentials" ON public.meta_credentials
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));
