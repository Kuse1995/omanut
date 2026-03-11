
CREATE TABLE public.boss_media_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  boss_phone text NOT NULL,
  image_url text NOT NULL,
  context text DEFAULT 'unknown',
  related_id uuid,
  twilio_sid text,
  status text NOT NULL DEFAULT 'pending',
  retry_count integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 3,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.boss_media_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins full access to boss media deliveries"
  ON public.boss_media_deliveries FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Company members can view boss media deliveries"
  ON public.boss_media_deliveries FOR SELECT
  TO authenticated
  USING (user_has_company_access_v2(company_id));

CREATE POLICY "System can insert boss media deliveries"
  ON public.boss_media_deliveries FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update boss media deliveries"
  ON public.boss_media_deliveries FOR UPDATE
  USING (true);
