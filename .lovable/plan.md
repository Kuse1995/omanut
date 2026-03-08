

# Switch Image Model to `gemini-3-pro-image-preview` (Nano Banana Pro)

## Problem
The `gemini-3.1-flash-image` model returns a 404 error from the native Gemini API — it's not available. The logs confirm: `"models/gemini-3.1-flash-image is not found for API version v1main"`.

## Fix
Replace all references to `gemini-3.1-flash-image` with `gemini-3-pro-image-preview` across 5 files:

| File | Lines | Change |
|------|-------|--------|
| `_shared/gemini-client.ts` | 75 | Default model fallback |
| `auto-content-creator/index.ts` | 149 | Explicit model param |
| `generate-business-image/index.ts` | 86 | Model in geminiChat call |
| `whatsapp-image-gen/index.ts` | 423, 495, 548 | Three geminiChat calls |
| `test-image-generation/index.ts` | 307 | Metadata/logging reference |

All occurrences of `gemini-3.1-flash-image` become `gemini-3-pro-image-preview`. No other logic changes needed — the API endpoint and request format remain the same.

