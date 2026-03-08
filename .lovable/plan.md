

# Upgrade Image Model to Gemini 3.1 Flash Image

## Change

Replace `gemini-2.5-flash-image` with `gemini-3.1-flash-image` in all image generation functions. Also update the `gemini-client.ts` to recognize the new model name as an image model.

### Files

| File | Change |
|------|--------|
| `supabase/functions/whatsapp-image-gen/index.ts` | Change model on lines 379, 451, 504 |
| `supabase/functions/generate-business-image/index.ts` | Change model on line 86 |
| `supabase/functions/test-image-generation/index.ts` | Change logged model name on line 307 |
| `supabase/functions/_shared/gemini-client.ts` | Verify `isImageModel()` detects the new name (it checks for `includes('image')` so it will route correctly — no change needed) |

All instances of `'gemini-2.5-flash-image'` → `'gemini-3.1-flash-image'` across the three generation files.

