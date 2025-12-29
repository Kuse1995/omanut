-- Allow admins to view generated images across all companies
-- (Required for the Admin Image Generation dashboard gallery)

ALTER TABLE public.generated_images ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Create admin SELECT policy if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public'
      AND tablename = 'generated_images'
      AND policyname = 'Admins can view all generated images'
  ) THEN
    CREATE POLICY "Admins can view all generated images"
    ON public.generated_images
    FOR SELECT
    USING (has_role(auth.uid(), 'admin'::public.app_role));
  END IF;
END $$;
