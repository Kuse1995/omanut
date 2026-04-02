
-- 1. Fix agent_config: remove public access, add authenticated-only
DROP POLICY IF EXISTS "Public access to agent_config" ON public.agent_config;
CREATE POLICY "Authenticated users can read agent_config"
  ON public.agent_config FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY "Admins can manage agent_config"
  ON public.agent_config FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 2. Fix onboarding_sessions: remove permissive system policy
DROP POLICY IF EXISTS "System can manage onboarding sessions" ON public.onboarding_sessions;
-- Service-role edge functions bypass RLS, so no replacement needed for system writes
-- Keep the admin SELECT policy that already exists

-- 3. Fix takeover_sessions: remove permissive system policy
DROP POLICY IF EXISTS "System can manage takeover sessions" ON public.takeover_sessions;
-- Service-role edge functions bypass RLS automatically

-- 4. Fix whatsapp_messages: restrict system policies to service_role only
DROP POLICY IF EXISTS "System can insert whatsapp messages" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "System can update whatsapp messages" ON public.whatsapp_messages;
-- Service-role edge functions bypass RLS automatically, no replacement needed
