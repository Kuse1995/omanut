ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS booking_type text,
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS channel text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS location_notes text,
  ADD COLUMN IF NOT EXISTS purpose text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS duration_minutes integer,
  ADD COLUMN IF NOT EXISTS assigned_to text;
COMMENT ON COLUMN public.reservations.booking_type IS 'demo | site_visit | consultation | appointment | table | other';
COMMENT ON COLUMN public.reservations.company_name IS 'The business the booking is for (B2B bookings).';
COMMENT ON COLUMN public.reservations.channel IS 'in_person | online | phone - how the booking happens.';
COMMENT ON COLUMN public.reservations.location IS 'Where the booking happens: the address the team travels to for in_person, or the platform/venue for online.';
COMMENT ON COLUMN public.reservations.location_notes IS 'Landmark, directions or Yango pin to help find the place.';
COMMENT ON COLUMN public.reservations.purpose IS 'What the customer wants from the booking, in their words.';
COMMENT ON COLUMN public.reservations.notes IS 'Anything else the team should know before the booking.';
COMMENT ON COLUMN public.reservations.duration_minutes IS 'Expected length of the booking in minutes.';
ALTER TABLE public.reservations ALTER COLUMN guests DROP NOT NULL;
ALTER TABLE public.reservations ALTER COLUMN guests SET DEFAULT 1;
CREATE INDEX IF NOT EXISTS reservations_company_date_idx ON public.reservations (company_id, date);