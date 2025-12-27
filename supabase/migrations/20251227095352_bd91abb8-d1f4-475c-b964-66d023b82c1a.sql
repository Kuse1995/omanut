-- Add live analysis toggle to company_ai_overrides
ALTER TABLE public.company_ai_overrides 
ADD COLUMN IF NOT EXISTS supervisor_live_analysis_enabled BOOLEAN DEFAULT true;