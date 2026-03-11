

# Conversational Approval Flow + Stricter Image Quality

## Problem

1. **No boss preview before scheduling**: When the AI generates an image for a post, it immediately schedules/publishes without showing the boss the image first. The boss never gets to say "looks good" or "try again."

2. **Quality gate is leaky**: After retries are exhausted, the pipeline returns whatever it has (line 696: "using best result") — even if it scored below 8.5. Failed images still get used.

## Changes

### 1. Conversational Approval in `schedule_social_post` (boss-chat/index.ts)

**Current flow**: generate image → insert into `scheduled_posts` → done
**New flow**: generate image → send preview to boss via WhatsApp → save as `pending_approval` → AI tells boss "Here's what I've got — approve or ask for changes"

When `needs_image_generation=true`:
- Generate the image (existing logic)
- Instead of inserting with `approved` status, insert with `pending_approval`
- Return the image URL in the tool result so the AI sends it as a media message
- The AI's text response naturally asks: "Here's the draft — want me to schedule it or make changes?"
- Boss replies "approve" → AI calls `review_pending_post` with `approve` action
- Boss replies "change the colors" → AI calls `edit_image` then shows updated version

**Key change in `schedule_social_post` handler** (~lines 1311-1440):
- Change `status: 'approved'` to `status: 'pending_approval'` when image was just generated
- Add the image URL to `toolMediaMessages` so the boss sees it inline
- Modify the result message to prompt for approval instead of confirming scheduling

**Update system prompt** (~lines 270-290):
- Add instruction: "When you generate an image for a post, ALWAYS show it to the boss and ask for approval before finalizing. Never auto-schedule a post with a freshly generated image."
- Add instruction: "If the boss already approved the image in a prior message (e.g., 'looks great, schedule it'), then you may use `review_pending_post` to approve."

### 2. Strict Quality Gate — No Fallthrough (whatsapp-image-gen/index.ts)

**Current** (line 696): After max retries, returns the image regardless of score.
**New**: If all retries fail quality check, return `{ success: false }` with a message explaining the quality wasn't good enough, rather than silently delivering a bad image.

Changes in `runImagePipeline` (~lines 687-706):
- After the retry loop, check if `qualityResult.pass` is still false
- If false, return a failure result instead of the low-quality image
- The boss-chat handler already handles `success: false` from image gen — it will tell the boss "Image didn't meet quality standards, want me to try a different approach?"

### 3. Raise Quality Threshold for Product Images (whatsapp-image-gen/index.ts)

**Current**: Pass threshold is 8.5/10 for all images (line 532).
**New**: 
- Product images (with `productMatch`): threshold stays 8.5 but hard-fail on any single criterion below 7 (up from the current below-4 check on line 529)
- Non-product images: threshold 7.5 (slightly more lenient since no brand fidelity concerns)

Changes in `qualityAssessmentAgent` (~lines 520-535):
- Add stricter per-criterion floor for product images
- Adjust the composite threshold based on whether a product is anchored

## Files
- `supabase/functions/boss-chat/index.ts` — conversational approval flow + prompt updates
- `supabase/functions/whatsapp-image-gen/index.ts` — strict quality gate, no fallthrough

## Summary

The boss will now always see the image and caption before anything gets scheduled. The AI presents it as a draft and waits for a "go ahead" or feedback. And images that don't pass quality simply won't be shared — the AI will explain and offer to retry with different direction.

