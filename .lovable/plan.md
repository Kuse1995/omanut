

# Fix: Image-First Publishing Pipeline

## The Problem

When the boss asks to publish a post with an image "right now," the current flow has a critical flaw:

1. Image generation is attempted with a 45-second timeout
2. If it doesn't finish in time, the post publishes as **text-only**
3. The image finishes generating in the background but is **never delivered or attached**
4. The AI tells the boss "the image will pop up soon" — but it never does

This is unacceptable for enterprise SaaS. A post with a requested image should never go out as text-only.

## The Fix: Generate First, Publish Second

Instead of racing image generation against a timeout and publishing regardless, the flow should be:

### Strategy: Two-Phase Approach

**Phase 1 — Generate image BEFORE publishing** (synchronous, no timeout race):
- When `publish_now=true` AND `needs_image_generation=true`, generate the image **first** with a generous timeout (90s)
- Only after the image is ready, publish the complete post (text + image)
- If image generation fails, tell the boss it failed and ask whether to publish text-only or retry — don't silently degrade

**Phase 2 — If image gen is truly slow, use a "pending" state**:
- Insert the post as `status: 'pending_image'` instead of publishing immediately
- Trigger image generation asynchronously
- When the image gen completes (via `whatsapp-image-gen`), it updates the post's `image_url` and auto-publishes
- Send a WhatsApp confirmation to the boss with the published post + image preview

### Files to Change

**1. `supabase/functions/boss-chat/index.ts`** — `schedule_social_post` tool handler (~lines 1258-1363)

- Remove the 45s timeout race pattern
- When `publish_now=true` + `needs_image_generation=true`:
  - Call `whatsapp-image-gen` synchronously (no timeout race)
  - If image returns successfully → publish with image
  - If image fails → insert post as `pending_image`, trigger async generation, tell boss "generating image, will publish automatically when ready"
- When `publish_now=true` + no image needed → publish immediately (unchanged)
- When scheduling for later + `needs_image_generation=true` → keep async pattern but ensure the image is attached before the scheduled publish time

**2. `supabase/functions/boss-chat/index.ts`** — Response message

- Remove misleading "generating in background, will pop up here" language
- Replace with accurate status: either "Published with image" or "Generating image — I'll publish and send you a preview once it's ready"

**3. `supabase/functions/publish-meta-post/index.ts`** — Add image-wait capability

- Before publishing, check if post has `needs_image` flag but no `image_url` yet
- If so, wait/retry briefly or skip (the async callback handles it)

**4. New callback in `whatsapp-image-gen` or a small helper** — Auto-publish after image ready

- When image generation completes for a post with `pending_image` status:
  - Update the post's `image_url`
  - Change status to `approved`
  - Call `publish-meta-post` to publish
  - Send WhatsApp message to boss with the image preview and confirmation

### Database Change

- Add `'pending_image'` as a valid status for `scheduled_posts` (if using enum, or just handle as string)

### Summary

The core principle: **never publish a degraded post silently**. Either wait for the image, or explicitly tell the boss and auto-publish when ready. The boss should never have to follow up asking "where's my image?"

