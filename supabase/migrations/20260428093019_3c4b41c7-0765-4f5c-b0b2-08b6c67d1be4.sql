CREATE OR REPLACE FUNCTION public.generate_claim_code()
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
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