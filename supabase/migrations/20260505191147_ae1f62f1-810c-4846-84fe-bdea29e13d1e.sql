ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS openclaw_drafter boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.companies.openclaw_drafter IS
  'When true, OpenClaw drafts replies and POSTs them to openclaw-reply; Omanut handles delivery. When false, legacy direct-send mode.';