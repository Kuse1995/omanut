
-- Create company_boss_phones table
CREATE TABLE public.company_boss_phones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  phone text NOT NULL,
  label text,
  is_primary boolean NOT NULL DEFAULT false,
  notify_reservations boolean NOT NULL DEFAULT true,
  notify_payments boolean NOT NULL DEFAULT true,
  notify_alerts boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint: one phone per company
ALTER TABLE public.company_boss_phones
  ADD CONSTRAINT company_boss_phones_company_phone_unique UNIQUE (company_id, phone);

-- Enable RLS
ALTER TABLE public.company_boss_phones ENABLE ROW LEVEL SECURITY;

-- RLS: company members can read
CREATE POLICY "Company members can view boss phones"
  ON public.company_boss_phones FOR SELECT
  TO authenticated
  USING (public.user_has_company_access_v2(company_id));

-- RLS: owners/managers can insert
CREATE POLICY "Owners and managers can add boss phones"
  ON public.company_boss_phones FOR INSERT
  TO authenticated
  WITH CHECK (public.has_company_role(company_id, 'manager'));

-- RLS: owners/managers can update
CREATE POLICY "Owners and managers can update boss phones"
  ON public.company_boss_phones FOR UPDATE
  TO authenticated
  USING (public.has_company_role(company_id, 'manager'));

-- RLS: owners/managers can delete
CREATE POLICY "Owners and managers can delete boss phones"
  ON public.company_boss_phones FOR DELETE
  TO authenticated
  USING (public.has_company_role(company_id, 'manager'));

-- Seed existing boss_phone values into the new table
INSERT INTO public.company_boss_phones (company_id, phone, label, is_primary)
SELECT id, boss_phone, 'Owner', true
FROM public.companies
WHERE boss_phone IS NOT NULL AND boss_phone != ''
ON CONFLICT DO NOTHING;

-- Trigger: sync primary boss phone back to companies.boss_phone
CREATE OR REPLACE FUNCTION public.sync_primary_boss_phone()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  -- On INSERT or UPDATE where is_primary = true, ensure only one primary per company
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.is_primary = true THEN
    UPDATE public.company_boss_phones
      SET is_primary = false
      WHERE company_id = NEW.company_id AND id != NEW.id AND is_primary = true;
    
    UPDATE public.companies
      SET boss_phone = NEW.phone
      WHERE id = NEW.company_id;
  END IF;

  -- On DELETE of a primary phone, pick next one or null
  IF TG_OP = 'DELETE' AND OLD.is_primary = true THEN
    UPDATE public.companies
      SET boss_phone = (
        SELECT phone FROM public.company_boss_phones
        WHERE company_id = OLD.company_id AND id != OLD.id
        ORDER BY created_at LIMIT 1
      )
      WHERE id = OLD.company_id;
    
    -- Mark the fallback as primary
    UPDATE public.company_boss_phones
      SET is_primary = true
      WHERE company_id = OLD.company_id
        AND id != OLD.id
        AND id = (
          SELECT id FROM public.company_boss_phones
          WHERE company_id = OLD.company_id AND id != OLD.id
          ORDER BY created_at LIMIT 1
        );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_boss_phone_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.company_boss_phones
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_primary_boss_phone();
