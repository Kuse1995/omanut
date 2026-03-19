

# Fix: Wrong Products in Images + Video Not Delivered

## Problems Identified

1. **Image pipeline generates wrong products**: When Vision AI explicitly returns "NONE" (no matching product), the fallback keyword matcher still picks a random product based on loose word overlap. This causes completely unrelated products to appear.

2. **Video not delivered**: The logs show the Veo path was still executing (400 error on image format). The MiniMax integration was added but the edge function deployment may not have completed. Additionally, the MiniMax client's `first_frame_image` field needs to be verified.

## Changes

### 1. `supabase/functions/whatsapp-image-gen/index.ts` — Stop keyword fallback after Vision AI says "NONE"

After the Vision AI explicitly selects "NONE" (line ~1139-1141), the code falls through to a keyword matcher that always finds *something*. Fix: when Vision AI returns "NONE", return `{ product: null, bmsImageUrls: [] }` immediately — do not fall through to keyword matching.

This ensures:
- If Vision AI says no product matches, the pipeline generates a scene/brand image without anchoring to a wrong product
- The "ASK-FIRST" safety rule is enforced

### 2. `supabase/functions/boss-chat/index.ts` — Ensure MiniMax path is robust

- Add a try/catch around the MiniMax call with a clear error if the API key is missing
- Remove any remaining Veo references in the generate_video tool handler
- Log the provider being used for debugging

### 3. `supabase/functions/_shared/minimax-client.ts` — Verify URL-based image input

- Confirm the `first_frame_image` field sends URLs correctly (current code looks correct)
- Add better error logging for the API response

## Files Modified
- `supabase/functions/whatsapp-image-gen/index.ts` — block keyword fallback when Vision says NONE
- `supabase/functions/boss-chat/index.ts` — harden MiniMax video path
- `supabase/functions/_shared/minimax-client.ts` — improve error handling

