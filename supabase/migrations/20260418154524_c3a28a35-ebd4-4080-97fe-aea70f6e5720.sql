UPDATE public.conversations
SET is_paused_for_human = false,
    human_takeover = false,
    takeover_at = NULL,
    takeover_by = NULL,
    active_agent = 'sales'
WHERE id = '67b90349-55e9-42c6-9f41-00d8fa601afa';