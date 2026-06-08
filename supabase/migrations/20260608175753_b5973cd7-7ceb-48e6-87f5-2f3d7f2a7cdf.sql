UPDATE public.companies SET openclaw_mode = 'off', openclaw_owns = '{}'::jsonb, openclaw_takeover_enabled = false;
UPDATE public.company_ai_overrides SET primary_model = 'MiniMax-M3';