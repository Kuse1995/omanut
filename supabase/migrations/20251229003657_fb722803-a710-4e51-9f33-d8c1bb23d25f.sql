-- Allow admins to manage image generation settings for any company
-- (Fixes admin dashboard "Failed to save settings" when editing other companies)

ALTER TABLE public.image_generation_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Admins: full access to image_generation_settings
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'image_generation_settings'
      AND policyname = 'Admins can manage all image generation settings'
  ) THEN
    CREATE POLICY "Admins can manage all image generation settings"
    ON public.image_generation_settings
    FOR ALL
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
  END IF;
END $$;
