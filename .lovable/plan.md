

## Fix: AI leaks raw storage URLs in WhatsApp media captions

### What the customer saw

After the media-tool fix, GreenGrid did send the photo — but the assistant's text reply also contained the **raw `https://dzheddvoiauevcayifev.supabase.co/storage/...` URL** alongside the caption. The image arrived twice in effect: once as a real WhatsApp media attachment, once as an ugly URL pasted into the message body.

### Root cause

In `supabase/functions/whatsapp-messages/index.ts`, `search_media` returns its results to the model as JSON containing the public storage `url` for each match (lines ~4571 and ~5276):

```json
{ "media": [{ "description": "...", "url": "https://dzheddvoiauevcayifev...", ... }] }
```

The model is told "use the exact URLs returned by `search_media` in `send_media`", so it dutifully copies the URL into the `send_media` arguments — and frequently into its own free-text caption too. Nothing strips that URL before the assistant text is sent over Twilio.

### Fix

**1. Hide URLs from the model — return opaque media IDs**
- In both `search_media` execution paths (background path ~line 4481 and tool-loop path ~line 5211), shape the tool result as:
  ```json
  { "media": [{ "media_id": "<uuid>", "description": "...", "category": "...", "media_type": "image", "tags": [...] }] }
  ```
  Drop `url` and `file_path` from what the model sees.
- Update the `send_media` tool schema (~line 2707) so it accepts `media_ids: string[]` instead of (or in addition to, with `media_urls` deprecated) `media_urls: string[]`. Keep backward compat: if `media_urls` is supplied, still process it via the existing `handleSendMedia`/`recoverMediaFromLibrary` path.
- In `handleSendMedia` (line 218), when `media_ids` are passed, resolve them server-side from `company_media` to public URLs scoped to `company.id` (defence-in-depth: reject any id whose `company_id` ≠ caller's company).
- Update the system prompt blocks at lines 2322-2324, 2465, 2479, 2711 to say: *"Call `search_media`, then `send_media` with the returned `media_id` values. Never write URLs in your reply text — the customer receives the actual image as an attachment."*

**2. Strip leaked URLs from assistant text (defence in depth)**
Add a post-processor right before the assistant reply is persisted/sent to Twilio that removes any `https://*supabase.co/storage/v1/object/...` URL (and any bare `company-media/...` path) from `assistantReply`. Collapse the resulting double-spaces / dangling colons. If the stripped text becomes empty, fall back to a short caption like "Here's one of our recent installs ☀️" (or empty if `send_media` already supplied a caption).

**3. Tighten the caption guidance**
In the system prompt media section, add: *"Your text reply should be a short human caption (max 1 short sentence). The media itself is delivered separately — do not describe URLs, file paths, or technical metadata."*

### Files

- `supabase/functions/whatsapp-messages/index.ts` —
  - `search_media` execution (background path + tool-loop path): replace `url`/`file_path` in tool output with `media_id` + minimal metadata.
  - `send_media` tool schema: accept `media_ids`. `handleSendMedia`: resolve `media_ids` → URLs via `company_media` lookup with `company_id` guard.
  - System prompt updates (lines ~2322-2327, 2465, 2479, 2711) — tell model to use ids, not URLs, and keep captions short.
  - New `stripLeakedMediaUrls(text)` helper, applied to every assistant text reply before it's persisted to `messages` and before Twilio dispatch.

No DB schema changes. No frontend changes. No auth changes.

### Validation

1. From `+260972064502` to GreenGrid: "send me a pic of solar panels" → AI sends image attachment + a short caption with **no URL** in the text.
2. Same flow on Finch / ANZ → still works; existing `search_media`→`send_media` chain unchanged behaviourally for the customer.
3. Inspect `messages` rows for the test conversation → `content` column contains caption only, no `supabase.co/storage` substring.
4. Force the model to put a URL in its reply (test by leaving old prompt cached) → post-processor strips it; image still delivered once.
5. Cross-tenant safety: try `send_media` with a `media_id` belonging to another company → rejected, no media sent, audit log entry.

