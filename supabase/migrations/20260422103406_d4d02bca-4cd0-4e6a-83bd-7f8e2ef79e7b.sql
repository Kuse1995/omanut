ALTER TABLE public.bms_connections
ADD COLUMN IF NOT EXISTS last_bms_sync_at timestamptz;