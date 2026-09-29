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

-- ZamCash Loans: use OpenAI's ChatGPT image model (GPT-Image 2.5) HOSTED ON FAL,
-- so it bills the fal key we already use - no separate OpenAI account needed.
--   openai/gpt-image-2.5/flare/text-to-image     (default: fast, high quality)
--   openai/gpt-image-2.5/sunburst/text-to-image  (alternate flavour - swap to compare)
-- Other companies keep fal's Nano Banana cascade untouched.
UPDATE public.image_generation_settings
SET image_provider = 'fal',
    image_model = 'openai/gpt-image-2.5/flare/text-to-image'
WHERE company_id = (SELECT id FROM public.companies WHERE name = 'ZamCash Loans' LIMIT 1);
