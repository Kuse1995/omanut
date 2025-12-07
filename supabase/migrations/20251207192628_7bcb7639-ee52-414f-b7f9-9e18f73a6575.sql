-- Add quality scoring fields to ai_error_logs
ALTER TABLE public.ai_error_logs 
ADD COLUMN IF NOT EXISTS quality_score integer DEFAULT NULL,
ADD COLUMN IF NOT EXISTS confidence_score integer DEFAULT NULL,
ADD COLUMN IF NOT EXISTS detected_flags text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS auto_flagged boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS analysis_details jsonb DEFAULT '{}';