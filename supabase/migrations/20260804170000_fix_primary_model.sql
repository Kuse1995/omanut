-- Fix the invalid primary_model written by migration 20260804144820.
-- 'deepseek-v4-flash' / 'deepseek-v4-pro' do not exist on the DeepSeek API and made every
-- AI call fail (ai_call_failed -> ai_fallback_chain_exhausted). 'deepseek-chat' is the
-- canonical DeepSeek API chat model and is verified working.
UPDATE public.company_ai_overrides
SET primary_model = 'deepseek-chat', updated_at = now()
WHERE primary_model IN ('deepseek-v4-flash', 'deepseek-v4-pro');
