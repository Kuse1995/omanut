-- Add supervisor agent configuration columns to company_ai_overrides
ALTER TABLE public.company_ai_overrides 
ADD COLUMN IF NOT EXISTS supervisor_analysis_depth TEXT DEFAULT 'balanced',
ADD COLUMN IF NOT EXISTS supervisor_focus_areas TEXT[] DEFAULT ARRAY['conversion_optimization', 'customer_satisfaction'],
ADD COLUMN IF NOT EXISTS supervisor_recommendation_style TEXT DEFAULT 'actionable',
ADD COLUMN IF NOT EXISTS supervisor_context_window INTEGER DEFAULT 10,
ADD COLUMN IF NOT EXISTS supervisor_research_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS supervisor_pattern_detection TEXT[] DEFAULT ARRAY['buying_signals', 'objections', 'sentiment_shifts'],
ADD COLUMN IF NOT EXISTS supervisor_urgency_triggers JSONB DEFAULT '{"high_value_customer": true, "complaint": true, "churn_risk": true}',
ADD COLUMN IF NOT EXISTS supervisor_output_format TEXT DEFAULT 'structured_json';