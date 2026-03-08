

# Fix Product Image Matching for Finch

## Problem
Finch's product images all have:
- **Description**: "Product image for AI generation" (identical for all)
- **Tags**: empty `[]`
- **File names**: UUIDs like `c7fcb095-bd3d-4d56-8baa-f2e4b0c93ef9.png`

The vision matcher sends these to Gemini with a catalog like:
```text
1. Name: "c7fcb095-bd3d-4d56-8baa-f2e4b0c93ef9.png", Tags: [none], Description: "Product image for AI generation"
2. Name: "275a4a33-9390-4620-af95-e04957ef212c.png", Tags: [none], Description: "Product image for AI generation"
...
```

The keyword pre-filter picks random images since nothing matches, and the vision model has no product context to supplement visual matching.

## Solution: Auto-Index Products on Upload

### 1. New edge function: `supabase/functions/index-brand-asset/index.ts`

When a product image is uploaded, call Gemini Vision to analyze it and auto-populate `description` and `tags` on the `company_media` row.

- Takes `media_id` and `company_id`
- Fetches the image from storage
- Sends to `gemini-2.5-flash` with a prompt like: "Describe this product image in detail. What is the product? What brand/text/labels are visible? What colors and shapes? Return JSON with `description` (1-2 sentences) and `tags` (array of keywords)."
- Updates `company_media` row with the AI-generated description and tags

### 2. Update `src/components/admin/BrandAssetLibrary.tsx`

After each successful upload + DB insert, fire-and-forget call to `index-brand-asset` to auto-analyze the image. No UI blocking — the analysis happens in the background.

### 3. New edge function: `supabase/functions/reindex-company-media/index.ts`

Batch re-index function that analyzes ALL existing product images for a company that still have the generic "Product image for AI generation" description. This fixes Finch's existing 10 images immediately.

- Fetches all `company_media` rows with generic descriptions
- Processes each through Gemini Vision
- Updates descriptions and tags

### 4. Strengthen vision matcher prompt in `whatsapp-image-gen/index.ts`

Update the `selectProductImageForPrompt` selection prompt to:
- Explicitly instruct: "Ignore text metadata if it's generic. Rely ENTIRELY on what you see in each image."
- Add: "Look for: product labels, brand names printed on packaging, product shape, color, size, and type."
- When metadata is all generic (detected by checking if all descriptions are identical), add a note: "WARNING: Text metadata is unreliable for these products. Use ONLY visual analysis."

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/index-brand-asset/index.ts` | New — auto-analyze uploaded product images with Gemini Vision |
| `supabase/functions/reindex-company-media/index.ts` | New — batch re-index existing images with generic descriptions |
| `src/components/admin/BrandAssetLibrary.tsx` | Call `index-brand-asset` after upload |
| `supabase/functions/whatsapp-image-gen/index.ts` | Strengthen vision matcher prompt for poor-metadata scenarios |
| `supabase/config.toml` | Add new function entries |

