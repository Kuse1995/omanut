

# Fix: Stop Redundant Image Generations in Boss-Chat

## What's happening
When you say "post it" after generating an image, the AI triggers a **new** image generation instead of reusing the one already created. Additionally, the `Promise.race` timeout pattern lets the original fetch continue running in the background, causing double generations.

## Four changes to `supabase/functions/boss-chat/index.ts`

### 1. Strengthen system prompt (line 311-313)
Add two new mandatory rules:
- **STRICT IMAGE REUSE**: When boss says "post it/this/schedule it", always use existing `image_url`, set `needs_image_generation=false`, never regenerate
- **ONE POST PER MESSAGE**: Only allow one `schedule_social_post` call per message

### 2. Add social post counter (line 1002-1005)
Add `socialPostCount = 0` and `MAX_SOCIAL_POSTS_PER_SESSION = 1` alongside the existing `imageGenCount`.

### 3. Hard-override in `schedule_social_post` handler (line 1245-1260)
- Add early exit if `socialPostCount >= MAX_SOCIAL_POSTS_PER_SESSION`
- Force `postImageUrl = toolImageUrl` **before** evaluating `needs_image_generation`
- This is a code-level block the AI cannot bypass — even if it sets `needs_image_generation=true`, the image won't regenerate because `postImageUrl` is already set
- Increment `socialPostCount` after successful post

### 4. Fix `generate_image` timeout double-fire (lines 1850-1887)
Replace `Promise.race` with `AbortController`:
- Creates an `AbortController` and passes its `signal` to `fetch()`
- On timeout, the original request is **cancelled** (not left running)
- Only then fires the async retry with boss delivery
- Prevents both requests from succeeding and creating duplicate images

## Impact
- Image scheduling still works perfectly for new requests
- "Post it" reuses existing images instead of regenerating
- Timeouts no longer produce ghost duplicates
- Max 1 post per boss message prevents accidental multi-posting

