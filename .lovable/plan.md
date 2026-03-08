

# Fix: WhatsApp Responses + Image Generation via Direct Gemini API

## Three Root Causes Found

### 1. WhatsApp messages still blocked by LOVABLE_API_KEY check
Line 3323 of `whatsapp-messages/index.ts` still checks for `LOVABLE_API_KEY` and throws if missing — this runs BEFORE any AI call. Even though the AI calls were migrated to `geminiChat`, this gatekeeper check still kills the entire function.

### 2. Image generation routes through Lovable Gateway (402 credits)
The shared `gemini-client.ts` routes ALL image models (anything with "image" in the name) through `lovableGatewayImageCall`, which requires `LOVABLE_API_KEY`. This means every image generation call hits the credit-limited gateway — even though text calls use `GEMINI_API_KEY` directly.

### 3. Image model names need updating
The `whatsapp-image-gen` function uses `gemini-3-pro-image-preview` and `gemini-2.5-flash-image-preview`. The user wants `google/gemini-2.5-flash-image` (Nano banana 2) as the image model.

## Changes

### File: `supabase/functions/whatsapp-messages/index.ts`

- **Remove the `LOVABLE_API_KEY` check** at lines 3323-3326. The function uses `geminiChat` which handles its own auth via `GEMINI_API_KEY`. This leftover check is what blocks Finch messages entirely.

### File: `supabase/functions/_shared/gemini-client.ts`

- **Route image models through direct Gemini API** instead of the Lovable Gateway. Use the native Gemini REST API (`https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`) with `GEMINI_API_KEY`.
- Parse the native Gemini response (which returns `inlineData` with base64 images) and reshape it into the OpenAI-compatible format that callers expect (with `images` array).
- Remove the `lovableGatewayImageCall` function entirely — no more dependency on `LOVABLE_API_KEY` for anything.

### File: `supabase/functions/whatsapp-image-gen/index.ts`

- **Update model names** to use `gemini-2.5-flash-image` (Nano banana 2) for all image generation calls (currently using `gemini-3-pro-image-preview` and `gemini-2.5-flash-image-preview`).

## Result

| Issue | Before | After |
|-------|--------|-------|
| Finch WhatsApp messages | Blocked by LOVABLE_API_KEY check | Works via GEMINI_API_KEY |
| Image generation | Routes through Lovable Gateway (402) | Direct Gemini API via GEMINI_API_KEY |
| Boss asks for posts with images | Images fail due to credit limit | Images generated via direct API |
| Image model | Mixed models | Nano banana 2 (`gemini-2.5-flash-image`) |

### Files Modified

| File | Change |
|------|--------|
| `supabase/functions/whatsapp-messages/index.ts` | Remove LOVABLE_API_KEY gatekeeper check |
| `supabase/functions/_shared/gemini-client.ts` | Route image models through direct Gemini API, remove Lovable Gateway dependency |
| `supabase/functions/whatsapp-image-gen/index.ts` | Update model to `gemini-2.5-flash-image` |

