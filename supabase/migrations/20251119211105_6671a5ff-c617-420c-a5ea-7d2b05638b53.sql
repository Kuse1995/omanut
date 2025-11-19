-- Add admin_last_active timestamp to track 24-hour service window
ALTER TABLE companies 
ADD COLUMN admin_last_active TIMESTAMPTZ DEFAULT NULL;

-- Add is_paused_for_human flag to conversations table
ALTER TABLE conversations
ADD COLUMN is_paused_for_human BOOLEAN DEFAULT FALSE;