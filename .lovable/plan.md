
Implementation plan for later (based on current code + logs):

1) Confirmed root causes
- Only one image is sent because `boss-chat` still returns a single `imageUrl` for multi-`schedule_social_post` runs (`toolImageUrl` gets overwritten by the last tool call).
- `whatsapp-messages` uses the single-image fallback path (`Has imageUrl: true` in logs), so only first chunk gets media.
- Captions are intentionally truncated in `boss-chat`:
  - `schedule_social_post` result uses `args.content.substring(0, 100)...`
  - `get_pending_posts` media caption uses `content.substring(0, 120)...`

2) File changes to implement

A) `supabase/functions/boss-chat/index.ts`
- Add accumulator for scheduled-post media payloads (not just one `toolImageUrl`).
- In each successful `schedule_social_post`, append one media item:
  - `{ body: full caption + post number + scheduled time + platform, imageUrl }`
  - Use full `args.content` (remove 100-char truncation for WhatsApp delivery content).
- Keep existing `get_pending_posts` `mediaMessages`, but remove/raise caption truncation there as well.
- When collecting tool outputs, merge media arrays (append), do not overwrite.
- If multiple posts are included, append final text-only message:
  - “Which of these would you like to edit or approve?”
- Return `mediaMessages` in payload whenever available (this should take precedence over single `imageUrl` behavior).

B) `supabase/functions/whatsapp-messages/index.ts`
- Keep current `mediaMessages` loop path, but harden it:
  - For each media item, run formatting cleanup.
  - If body is long, split into chunks (reuse `splitMessage`), attach `MediaUrl` only to first chunk of that post.
  - Send chunks/messages sequentially with delay (existing 500ms).
- Keep existing single-image fallback unchanged for legacy paths.

C) Optional hardening (recommended)
- In `boss-chat`, log model `finish_reason` and token usage when available.
- Enforce safer output budget for boss responses (e.g., floor for max tokens) to avoid true model-length truncation in complex multi-post replies.

3) Validation checklist after implementation
- WhatsApp command: “schedule two posts …”
  - Expect separate outbound messages per post with distinct image URLs.
  - Expect full captions (not 100/120-char previews).
  - Expect final prompt: “Which of these would you like to edit or approve?”
- “show pending posts”
  - Expect one media message per pending post + final prompt.
- Logs should show media-message path used (not `Has imageUrl` fallback only).
- Single-post flows should still work exactly as before.

4) Scope note
- No database migration required for this fix; this is edge-function response formatting/dispatch logic only.
