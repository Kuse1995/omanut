ALTER TABLE public.image_generation_settings
  ADD COLUMN IF NOT EXISTS image_provider text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS image_model text DEFAULT NULL;

COMMENT ON COLUMN public.image_generation_settings.image_provider IS 'Image engine for this company: fal | openai | NULL (= IMAGE_PROVIDER env default)';
COMMENT ON COLUMN public.image_generation_settings.image_model IS 'Exact image model id for the chosen provider (NULL = provider default/env)';

UPDATE public.image_generation_settings
SET image_provider = 'fal',
    image_model = 'openai/gpt-image-2.5/flare/text-to-image'
WHERE company_id = (SELECT id FROM public.companies WHERE name = 'ZamCash Loans' LIMIT 1);