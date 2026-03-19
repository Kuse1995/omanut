

# Fix: Add Variability to First-Frame Generation

## Problem
The auto-generated first frame uses a deterministic prompt template. When a user requests the same type of video multiple times, the identical prompt produces the same image, leading to identical videos.

## Solution
Inject creative variability into the first-frame prompt so each generation produces a unique composition, even for the same product/subject.

## Changes

### `supabase/functions/boss-chat/index.ts` — First-frame prompt diversification

1. **Add a creative variation system** before the `firstFramePrompt` construction (around line 2523):
   - Define arrays of variation elements: camera angles (`overhead shot`, `45-degree angle`, `eye-level`, `low angle hero shot`), lighting styles (`warm golden hour`, `cool studio`, `dramatic side light`, `soft diffused`), background treatments (`gradient backdrop`, `lifestyle setting`, `minimalist white`, `textured surface`), and composition styles (`rule of thirds`, `centered symmetrical`, `dynamic diagonal`, `close-up detail`)
   - Randomly pick one from each array using `Math.random()`
   - Include a timestamp-based seed phrase (e.g., `variation ${Date.now() % 1000}`) for additional uniqueness

2. **Update the prompt template** to incorporate these variations:
   ```
   "Professional product photo for video opening frame. 
    ${staticPrompt}. 
    ${randomAngle}, ${randomLighting}, ${randomBackground}, 
    ${randomComposition}. High resolution."
   ```

3. **Log the variation** so we can debug which creative direction was chosen:
   ```
   console.log('[BOSS-VID] First frame variation:', { angle, lighting, background, composition });
   ```

This keeps the Product Identity Lock and brand accuracy intact (those come from `whatsapp-image-gen`'s internal pipeline) while ensuring each first frame looks visually distinct.

## Files Modified
- `supabase/functions/boss-chat/index.ts` — randomized creative direction in first-frame prompt

