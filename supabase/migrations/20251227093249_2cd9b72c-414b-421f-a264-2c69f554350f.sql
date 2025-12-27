-- Add new columns for boss reporting configuration
ALTER TABLE public.company_ai_overrides ADD COLUMN IF NOT EXISTS boss_reporting_style TEXT DEFAULT 'concise';
ALTER TABLE public.company_ai_overrides ADD COLUMN IF NOT EXISTS boss_data_focus TEXT[] DEFAULT ARRAY['revenue', 'conversations', 'reservations'];
ALTER TABLE public.company_ai_overrides ADD COLUMN IF NOT EXISTS boss_alert_triggers JSONB DEFAULT '{"low_engagement": true, "missed_opportunities": true, "negative_feedback": true}'::jsonb;
ALTER TABLE public.company_ai_overrides ADD COLUMN IF NOT EXISTS boss_daily_briefing_template TEXT;
ALTER TABLE public.company_ai_overrides ADD COLUMN IF NOT EXISTS boss_metric_goals JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.company_ai_overrides ADD COLUMN IF NOT EXISTS boss_preferred_language TEXT DEFAULT 'en';
ALTER TABLE public.company_ai_overrides ADD COLUMN IF NOT EXISTS boss_report_frequency TEXT DEFAULT 'on_request';
ALTER TABLE public.company_ai_overrides ADD COLUMN IF NOT EXISTS boss_comparison_period TEXT DEFAULT 'last_week';