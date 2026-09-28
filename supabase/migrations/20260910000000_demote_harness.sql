-- DEMOTE THE FARM HARNESS (2026-09-26)
--
-- Why: the omanut-harness (GLM-5.3 on the farm) has been returning canned
-- placeholders and masking its own upstream failures. Every company routed
-- through it produced non-answers ("Thanks for your message! We'll get back to
-- you shortly.") and worse - a leaked internal instruction into a public
-- Facebook comment. Its GLM/Zhipu account needs a balance check before it can
-- be trusted as a primary brain again.
--
-- What: harness_mode = 'off' for every company, so WhatsApp, Facebook comments
-- and DMs route to the direct model chain (DeepSeek -> Kimi), which is funded,
-- actively billed, and producing real contextual answers (proven by the
-- On The Build Zambia TradeList funnel).
--
-- Re-enable per company later (only after the farm's GLM balance is verified):
--   UPDATE public.companies
--   SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{harness_mode}', '"on"')
--   WHERE id = '<company-uuid>';

UPDATE public.companies
SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{harness_mode}', '"off"')
WHERE COALESCE(metadata->>'harness_mode', 'off') <> 'off';
