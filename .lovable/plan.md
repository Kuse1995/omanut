

# Switch Image Generation to OpenAI `gpt-image-1.5`

## Overview

Replace all `geminiImageGenerate()` calls with a new `openaiImageGenerate()` function using OpenAI's native Images API (`POST https://api.openai.com/v1/images/generations`) with `gpt-image-1.5` — their latest, highest-performance image model.

The `OPENAI_API_KEY` is already configured in secrets (used by the realtime voice session).

## API Details (from OpenAI docs)

- **Generation**: `POST /v1/images/generations` with `model: "gpt-image-1.5"`
- **Editing** (with input images): `POST /v1/images/edits` with `model: "gpt-image-1.5"`
- Returns `b64_json` by default for GPT image models
- Sizes: `1024x1024`, `1024x1536`, `1536x1024`, `auto`
- Quality: `low`, `medium`, `high`, `auto`
- Output format: `png`, `webp`, `jpeg`

## Changes

### 1. `supabase/functions/_shared/gemini-client.ts` — Add two new exports

**`openaiImageGenerate()`** — for fresh image generation:
- Calls `POST https://api.openai.com/v1/images/generations`
- Uses `OPENAI_API_KEY`, model `gpt-image-1.5`, output `b64_json`
- Returns `{ imageBase64, text }` for drop-in compatibility

**`openaiImageEdit()`** — for editing existing images (used in product-anchored gen and edit flows):
- Calls `POST https://api.openai.com/v1/images/edits` with source image as input
- Fetches remote image, converts to file upload format
- Same return signature

### 2. `supabase/functions/whatsapp-image-gen/index.ts` — 2 call sites

| Location | Change |
|----------|--------|
| Line ~662 (main generation) | When `inputImages` are present (product-anchored), use `openaiImageEdit()` with reference images. Otherwise use `openaiImageGenerate()` |
| Line ~1061 (editImage function) | Replace with `openaiImageEdit()` passing `sourceImageUrl` |
| Import | Add `openaiImageGenerate, openaiImageEdit`, remove `geminiImageGenerate` |

### 3. `supabase/functions/generate-business-image/index.ts` — 1 call site

Replace `geminiImageGenerate` → `openaiImageGenerate`. No input images used here.

### 4. `supabase/functions/auto-content-creator/index.ts` — 1 call site

Same swap — `geminiImageGenerate` → `openaiImageGenerate`.

### 5. `supabase/functions/test-image-generation/index.ts` — 1 call site

Same swap. This function also uses input images for product-anchored testing, so route to `openaiImageEdit` when `inputImageUrls` present.

## What stays the same

- Text-based agents (Prompt Optimizer, Supervisor, Quality Assessment) remain on `geminiChat`/`geminiChatJSON` — only the pixel generation moves to OpenAI
- `geminiImageGenerate` function stays in the shared client (not removed) in case needed later
- No database changes
- No new secrets needed (`OPENAI_API_KEY` already exists)

