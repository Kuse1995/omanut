-- Update reservations table for boss confirmation workflow
ALTER TABLE public.reservations 
ALTER COLUMN status SET DEFAULT 'pending_boss_approval';

-- Add boss approval fields
ALTER TABLE public.reservations 
ADD COLUMN IF NOT EXISTS boss_approved_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS boss_rejection_reason text;

-- Add index for faster availability queries
CREATE INDEX IF NOT EXISTS idx_reservations_date_time_status 
ON public.reservations(company_id, date, time, status);

-- Update existing confirmed reservations to keep them confirmed
UPDATE public.reservations 
SET status = 'confirmed' 
WHERE status = 'confirmed';