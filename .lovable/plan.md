

# Fix: Wrong Image Being Published on Social Media

## Root Causes Found

There are **two distinct bugs** causing the wrong image to be posted:

### Bug 1: `schedule_social_post` regenerates images instead of using existing ones
When the boss generates an image (via `generate_image` tool), sees it, approves it, then says "post it" — the AI calls `schedule_social_post` with `needs_image_generation=true` and a new `image_prompt`. This triggers a **brand new image generation** (lines 1264-1284 in boss-chat) instead of using the image the boss just approved.

The `toolImageUrl` variable tracks the last generated image, but there's no mechanism to pass it to the `schedule_social_post` tool automatically. The AI has no instruction to use `image_url` (the existing image) instead of `needs_image_generation`.

### Bug 2: `approve_and_publish` calls the wrong function
The `review_pending_post` with `approve_and_publish` action (line 1417) calls the **legacy** `publish-facebook-post` function (which queries the old `facebook_scheduled_posts` table) instead of the current `publish-meta-post` function. This means immediate publishing from the approval queue is broken or uses a different path entirely.

## Fixes

### 1. Fix `schedule_social_post` — use existing image when available
In the `schedule_social_post` handler, before calling `whatsapp-image-gen`, check if `toolImageUrl` already has a value (from a prior `generate_image` call in the same conversation). If so, use that instead of generating a new image.

Also update the AI system prompt to instruct it: when chaining `generate_image` → `schedule_social_post`, pass the returned `imageUrl` as `image_url` instead of setting `needs_image_generation=true`.

### 2. Fix `approve_and_publish` — use `publish-meta-post`
Change line 1417 from calling `publish-facebook-post` with `{ companyId, content, imageUrl }` to calling `publish-meta-post` with `{ post_id: postId }`. Also update the post status to `approved` first so `publish-meta-post` accepts it.

### 3. Add prompt guidance for image reuse
Add explicit instructions to the system prompt telling the AI: "If you already generated an image in this conversation, pass its URL as `image_url` to `schedule_social_post` instead of setting `needs_image_generation` to true."

## File Changed

| File | Change |
|------|--------|
| `supabase/functions/boss-chat/index.ts` | Fix `schedule_social_post` to prefer `toolImageUrl`, fix `approve_and_publish` to call `publish-meta-post`, add prompt guidance |

