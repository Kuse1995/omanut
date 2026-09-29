-- Per-company image generation engine.
-- Until now the image provider was a single global env (IMAGE_PROVIDER) affecting
-- every company. This adds a per-company choice so, for example, ZamCash can use
-- OpenAI's image models (stronger on realistic people/hands) while other
-- companies stay on fal's Nano Banana.
--
--   image_provider: 'fal' | 'openai' | NULL (NULL = fall back to the env default)
--   image_model:    the exact model id for that provider (NULL = env default)

ALTER TABLE public.image_generation_settings
  ADD COLUMN IF NOT EXISTS image_provider text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS image_model text DEFAULT NULL;

COMMENT ON COLUMN public.image_generation_settings.image_provider IS 'Image engine for this company: fal | openai | NULL (= IMAGE_PROVIDER env default)';
COMMENT ON COLUMN public.image_generation_settings.image_model IS 'Exact image model id for the chosen provider (NULL = provider default/env)';

-- ZamCash Loans: switch its images to OpenAI (its settings row already exists
-- with the ZamCash visual style). The model id itself comes from the
-- OPENAI_IMAGE_MODEL env var so it can be corrected without a migration.
UPDATE public.image_generation_settings
SET image_provider = 'openai'
WHERE company_id = (SELECT id FROM public.companies WHERE name = 'ZamCash Loans' LIMIT 1);
