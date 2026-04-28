
-- 1. Table
CREATE TABLE public.company_claim_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_company_claim_codes_code ON public.company_claim_codes(code);

ALTER TABLE public.company_claim_codes ENABLE ROW LEVEL SECURITY;

-- Only platform admins can read/manage codes directly
CREATE POLICY "Admins can view claim codes"
ON public.company_claim_codes FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert claim codes"
ON public.company_claim_codes FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update claim codes"
ON public.company_claim_codes FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete claim codes"
ON public.company_claim_codes FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 2. Code generator (4-4-4 base32 style, no ambiguous chars)
CREATE OR REPLACE FUNCTION public.generate_claim_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out text := '';
  i int;
  rnd int;
BEGIN
  FOR i IN 1..12 LOOP
    rnd := floor(random() * length(chars))::int + 1;
    out := out || substr(chars, rnd, 1);
    IF i = 4 OR i = 8 THEN out := out || '-'; END IF;
  END LOOP;
  RETURN out;
END;
$$;

-- 3. Trigger: auto-create a claim code when a new company is inserted
CREATE OR REPLACE FUNCTION public.create_claim_code_for_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_code text;
  attempts int := 0;
BEGIN
  LOOP
    new_code := public.generate_claim_code();
    BEGIN
      INSERT INTO public.company_claim_codes(company_id, code) VALUES (NEW.id, new_code);
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      attempts := attempts + 1;
      IF attempts > 5 THEN RAISE; END IF;
    END;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_create_claim_code_on_company_insert
AFTER INSERT ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.create_claim_code_for_company();

-- 4. Backfill for existing companies (no row yet)
INSERT INTO public.company_claim_codes (company_id, code)
SELECT c.id, public.generate_claim_code()
FROM public.companies c
WHERE NOT EXISTS (SELECT 1 FROM public.company_claim_codes cc WHERE cc.company_id = c.id);

-- 5. Claim function — callable by any signed-in user
CREATE OR REPLACE FUNCTION public.claim_company(_code text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.company_claim_codes%ROWTYPE;
  v_company_name text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_row FROM public.company_claim_codes
  WHERE upper(code) = upper(trim(_code))
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid claim code';
  END IF;

  IF v_row.claimed_by IS NOT NULL THEN
    -- Allow same user to "re-claim" idempotently
    IF v_row.claimed_by = v_user THEN
      SELECT name INTO v_company_name FROM public.companies WHERE id = v_row.company_id;
      RETURN json_build_object('success', true, 'company_id', v_row.company_id, 'company_name', v_company_name, 'already_owned', true);
    END IF;
    RAISE EXCEPTION 'This company has already been claimed';
  END IF;

  -- Insert into company_users as owner (idempotent)
  INSERT INTO public.company_users(company_id, user_id, role, is_default, accepted_at)
  VALUES (v_row.company_id, v_user, 'owner', true, now())
  ON CONFLICT (company_id, user_id) DO UPDATE SET role = 'owner', accepted_at = COALESCE(company_users.accepted_at, now());

  -- Mark claimed
  UPDATE public.company_claim_codes
  SET claimed_by = v_user, claimed_at = now()
  WHERE id = v_row.id;

  -- Mirror in legacy users table so existing role checks keep working
  INSERT INTO public.users(id, email, company_id, role)
  SELECT v_user, (SELECT email FROM auth.users WHERE id = v_user), v_row.company_id, 'admin'
  ON CONFLICT (id) DO UPDATE SET company_id = EXCLUDED.company_id;

  -- Grant 'client' app role so they pass the /login gate
  INSERT INTO public.user_roles(user_id, role)
  VALUES (v_user, 'client')
  ON CONFLICT DO NOTHING;

  SELECT name INTO v_company_name FROM public.companies WHERE id = v_row.company_id;

  RETURN json_build_object('success', true, 'company_id', v_row.company_id, 'company_name', v_company_name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_company(text) TO authenticated;

-- 6. Helper for admins to list codes alongside company name
CREATE OR REPLACE FUNCTION public.admin_list_claim_codes()
RETURNS TABLE(company_id uuid, company_name text, code text, claimed_by uuid, claimed_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT cc.company_id, c.name, cc.code, cc.claimed_by, cc.claimed_at
  FROM public.company_claim_codes cc
  JOIN public.companies c ON c.id = cc.company_id
  WHERE public.has_role(auth.uid(), 'admin')
  ORDER BY c.name;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_claim_codes() TO authenticated;
