-- Add Google Calendar fields to companies table
ALTER TABLE companies 
ADD COLUMN IF NOT EXISTS google_calendar_id TEXT,
ADD COLUMN IF NOT EXISTS calendar_sync_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS booking_buffer_minutes INTEGER DEFAULT 15;

-- Add Google Calendar fields to reservations table
ALTER TABLE reservations
ADD COLUMN IF NOT EXISTS google_calendar_event_id TEXT,
ADD COLUMN IF NOT EXISTS calendar_sync_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS calendar_event_link TEXT;

-- Create calendar_conflicts table for logging conflicts
CREATE TABLE IF NOT EXISTS calendar_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  requested_date DATE NOT NULL,
  requested_time TIME NOT NULL,
  conflicting_event_id TEXT,
  conflicting_event_title TEXT,
  resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on calendar_conflicts
ALTER TABLE calendar_conflicts ENABLE ROW LEVEL SECURITY;

-- RLS policy for calendar_conflicts
CREATE POLICY "Users can view their company calendar conflicts"
ON calendar_conflicts
FOR SELECT
USING (company_id IN (
  SELECT company_id FROM users WHERE id = auth.uid()
));