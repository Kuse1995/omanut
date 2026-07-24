UPDATE public.company_ai_overrides
SET primary_model = 'kimi-k2.6'
WHERE primary_model IN ('kimi-k3','kimi-k2-thinking','kimi-k2-0711-preview','kimi-k2-turbo-preview');