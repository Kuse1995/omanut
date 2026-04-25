-- 1. Backfill: strip whitespace and non-(+digit) chars from existing boss phones
UPDATE public.companies
SET boss_phone = regexp_replace(boss_phone, '[^+0-9]', '', 'g')
WHERE boss_phone IS NOT NULL
  AND boss_phone <> regexp_replace(boss_phone, '[^+0-9]', '', 'g');

UPDATE public.company_boss_phones
SET phone = regexp_replace(phone, '[^+0-9]', '', 'g')
WHERE phone <> regexp_replace(phone, '[^+0-9]', '', 'g');

-- 2. Sanitize trigger function (shared)
CREATE OR REPLACE FUNCTION public.sanitize_boss_phone()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'companies' THEN
    IF NEW.boss_phone IS NOT NULL THEN
      NEW.boss_phone := regexp_replace(NEW.boss_phone, '[^+0-9]', '', 'g');
      IF NEW.boss_phone <> '' AND NEW.boss_phone !~ '^\+\d{8,15}$' THEN
        RAISE EXCEPTION 'Invalid boss_phone format. Must be E.164 (e.g. +260977123456). Got: %', NEW.boss_phone;
      END IF;
      IF NEW.boss_phone = '' THEN NEW.boss_phone := NULL; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'company_boss_phones' THEN
    NEW.phone := regexp_replace(NEW.phone, '[^+0-9]', '', 'g');
    IF NEW.phone !~ '^\+\d{8,15}$' THEN
      RAISE EXCEPTION 'Invalid phone format. Must be E.164 (e.g. +260977123456). Got: %', NEW.phone;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sanitize_boss_phone_companies ON public.companies;
CREATE TRIGGER sanitize_boss_phone_companies
  BEFORE INSERT OR UPDATE OF boss_phone ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.sanitize_boss_phone();

DROP TRIGGER IF EXISTS sanitize_boss_phone_phones ON public.company_boss_phones;
CREATE TRIGGER sanitize_boss_phone_phones
  BEFORE INSERT OR UPDATE OF phone ON public.company_boss_phones
  FOR EACH ROW
  EXECUTE FUNCTION public.sanitize_boss_phone();