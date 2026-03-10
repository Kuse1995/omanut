

# Revert Image Generation to Gemini `gemini-3-pro-image-preview`

Switch all image generation calls back from OpenAI (`openaiImageGenerate`/`openaiImageEdit`) to the original `geminiImageGenerate` function which uses Gemini's native API.

## Changes

### 1. `supabase/functions/generate-business-image/index.ts`
- Import `geminiImageGenerate` instead of `openaiImageGenerate`
- Replace call: `geminiImageGenerate({ prompt: enhancedPrompt })`

### 2. `supabase/functions/auto-content-creator/index.ts`
- Import `geminiImageGenerate` instead of `openaiImageGenerate`
- Replace call: `geminiImageGenerate({ prompt: imagePrompt })`

### 3. `supabase/functions/whatsapp-image-gen/index.ts`
- Import `geminiImageGenerate` instead of `openaiImageGenerate`/`openaiImageEdit`
- Line ~664: Replace with `geminiImageGenerate({ prompt: genPrompt, inputImageUrls: inputImages })` (Gemini natively supports input images)
- Line ~1068: Replace `openaiImageEdit` with `geminiImageGenerate({ prompt: editInstruction, inputImageUrls: [sourceImageUrl] })`

### 4. `supabase/functions/test-image-generation/index.ts`
- Same pattern — swap back to `geminiImageGenerate`

### No other changes needed
- The `geminiImageGenerate` function already exists in `_shared/gemini-client.ts` and supports `inputImageUrls`
- The OpenAI functions stay in the shared client (not removed) in case needed later
- No database changes

