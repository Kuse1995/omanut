-- Update default AI models to latest versions in company_ai_overrides
ALTER TABLE public.company_ai_overrides
ALTER COLUMN primary_model SET DEFAULT 'google/gemini-3-pro-preview',
ALTER COLUMN analysis_model SET DEFAULT 'google/gemini-3-flash-preview';

-- Update existing rows that still use old models
UPDATE public.company_ai_overrides
SET primary_model = 'google/gemini-3-pro-preview'
WHERE primary_model = 'google/gemini-2.5-pro' OR primary_model IS NULL;

UPDATE public.company_ai_overrides
SET analysis_model = 'google/gemini-3-flash-preview'
WHERE analysis_model = 'google/gemini-2.5-flash' OR analysis_model IS NULL;