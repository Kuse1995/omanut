-- Add role and new notification columns to company_boss_phones
ALTER TABLE public.company_boss_phones
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'owner',
  ADD COLUMN IF NOT EXISTS role_label text,
  ADD COLUMN IF NOT EXISTS notify_social_media boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_content_approval boolean NOT NULL DEFAULT false;

-- Validation trigger (per memory: prefer triggers over CHECK constraints)
CREATE OR REPLACE FUNCTION public.validate_boss_phone_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.role NOT IN ('owner','manager','social_media_manager','accountant','operations','support_lead','custom') THEN
    RAISE EXCEPTION 'Invalid role: %. Must be one of owner, manager, social_media_manager, accountant, operations, support_lead, custom', NEW.role;
  END IF;
  IF NEW.role = 'custom' AND (NEW.role_label IS NULL OR length(trim(NEW.role_label)) = 0) THEN
    RAISE EXCEPTION 'role_label is required when role is custom';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_boss_phone_role_trigger ON public.company_boss_phones;
CREATE TRIGGER validate_boss_phone_role_trigger
  BEFORE INSERT OR UPDATE ON public.company_boss_phones
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_boss_phone_role();

-- Backfill: primary -> owner (default already owner), non-primary -> manager
UPDATE public.company_boss_phones
SET role = 'manager'
WHERE is_primary = false AND role = 'owner';

-- Backfill notify_social_media and notify_content_approval for existing owners
UPDATE public.company_boss_phones
SET notify_social_media = true,
    notify_content_approval = true
WHERE role = 'owner';