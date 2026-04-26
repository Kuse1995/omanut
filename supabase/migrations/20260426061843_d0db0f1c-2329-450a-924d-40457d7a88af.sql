ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ad_context jsonb,
  ADD COLUMN IF NOT EXISTS ad_referral_id text,
  ADD COLUMN IF NOT EXISTS ctwa_clid text;

CREATE INDEX IF NOT EXISTS idx_conversations_ad_referral
  ON public.conversations(ad_referral_id)
  WHERE ad_referral_id IS NOT NULL;