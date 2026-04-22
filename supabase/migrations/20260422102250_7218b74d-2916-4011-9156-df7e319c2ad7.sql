-- Pin ANZ to direct-provider models only (no Lovable AI Gateway)
UPDATE public.company_ai_overrides
SET primary_model = 'glm-4.7',
    analysis_model = 'glm-4.7',
    routing_model = 'glm-4.5-air',
    updated_at = now()
WHERE company_id = '74ec87e8-a075-45b7-af75-e7503d683818';