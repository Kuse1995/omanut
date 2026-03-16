

# Fix: Stop Runaway Image Generations & Wrong Product Selection

## Root Causes Found in Logs

1. **"Create a post" always triggers image gen**: System prompt (line 275) explicitly says `needs_image_generation=true by default`. The AI obeys this even when the boss just wants to post existing content.

2. **Wrong product in generated images**: `selectProductImageForPrompt` in `whatsapp-image-gen` returns `bmsImageUrls` (all BMS product images) even when Vision AI selects "NONE". These get injected as "priority anchors" into the pipeline (line 741-743), causing random products to appear.

3. **Double image generation**: When `generate_image` times out (line 1894), the catch block fires a NEW async request (line 1897). But aborting a fetch only cancels the *client read* — the server-side `whatsapp-image-gen` function continues running and completes. So both the original and the retry produce images.

4. **Async fire-and-forget in `schedule_social_post`**: When sync image gen fails/times out (lines 1412-1424, 1480-1492), it fires another async `whatsapp-image-gen` call — potentially stacking on top of the still-running original.

## Fixes (2 files)

### File 1: `supabase/functions/boss-chat/index.ts`

| # | What | Where | Detail |
|---|------|-------|--------|
| 1 | Remove "needs_image_generation=true by default" | Line 275 | Change to: "Default to needs_image_generation=false. Only set true if the boss EXPLICITLY asks for an image to be created/generated. For posting, reuse recent images." |
| 2 | Auto-reuse recent image in `schedule_social_post` | Lines 1264-1272 | Before evaluating `needsImageGen`, if no `postImageUrl` and no `toolImageUrl`, auto-query `generated_images` for the last 30 min. If found, use it. Skip generation. |
| 3 | Remove async retry in `generate_image` catch | Lines 1897-1901 | Delete the fire-and-forget fetch. The server-side request is still running. Just set `__imageGenInProgress = true` and tell the boss to wait. |
| 4 | Guard async fire-and-forget in `schedule_social_post` | Lines 1412-1424, 1480-1492 | Add `__imageGenInProgress` check before firing async gen. If already in progress, skip. |
| 5 | Strengthen prompt: reuse-first + ask-first | Lines 270-317 | Add: "REUSE-FIRST RULE: When scheduling posts, check get_recent_images before generating. ASK-FIRST RULE: If the product is unclear, ask the boss which product before generating." |

### File 2: `supabase/functions/whatsapp-image-gen/index.ts`

| # | What | Where | Detail |
|---|------|-------|--------|
| 6 | Clear `bmsImageUrls` when Vision AI returns "NONE" | ~Line 1122 | When `aiChoice === 'NONE'`, return `{ product: null, bmsImageUrls: [] }` instead of `{ product: null, bmsImageUrls }`. This prevents random BMS product images from being injected as anchors when no product match exists. |
| 7 | Skip BMS anchors in pipeline when no product match | ~Line 741 | Add guard: only use `bmsImageUrls` if `productMatch` is not null. This is a second safety layer. |

## Expected Result

- "Create a post about X" → uses recent image if available, otherwise creates text-only draft and asks if boss wants an image
- "Post it" → reuses the last generated image (existing behavior, now more reliable)
- Wrong product → Vision AI "NONE" no longer injects random product photos; asks boss to specify
- No more double generations from timeout retries

## No Database Changes

