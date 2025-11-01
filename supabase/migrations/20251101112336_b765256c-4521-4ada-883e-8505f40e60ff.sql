-- Add human takeover tracking to conversations
ALTER TABLE public.conversations 
ADD COLUMN human_takeover boolean DEFAULT false,
ADD COLUMN takeover_by uuid REFERENCES auth.users(id),
ADD COLUMN takeover_at timestamp with time zone;

COMMENT ON COLUMN public.conversations.human_takeover IS 'Whether a human has taken over this conversation';
COMMENT ON COLUMN public.conversations.takeover_by IS 'User ID who took over the conversation';
COMMENT ON COLUMN public.conversations.takeover_at IS 'When the conversation was taken over';