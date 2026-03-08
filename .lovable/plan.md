

# Wire BMS Product Images into Image Generation Pipeline

## What Changed
The BMS bridge now returns `image_url` and `image_urls` fields on `check_stock` and `get_product_details` responses. We need to update the image generation pipeline to use these authoritative product photos as reference anchors.

## Current Flow
1. `selectProductImageForPrompt()` searches `company_media` table for product images
2. It calls `bms-agent` → `get_product_details` but only uses the response for *text context* (name, SKU, stock count)
3. The matched `company_media` image becomes the reference anchor for Gemini generation

## Problem
BMS product images (the actual canonical photos) are available but never used as visual references. The pipeline still relies on manually uploaded `company_media` entries, which may be missing or mismatched.

## Proposed Changes

### 1. Update `selectProductImageForPrompt()` in `whatsapp-image-gen/index.ts`
- When `bms-agent` returns `image_urls`, pass them back alongside the `company_media` match
- Return a new field `bmsImageUrls: string[]` from the function

### 2. Update the generation pipeline (lines ~484-498)
- Inject BMS `image_urls` as **priority reference images** before `company_media` references
- If BMS provides product images, use the first one as the "EXACT product" anchor (currently only `company_media` matches get this treatment)
- Fallback: if no BMS images, use `company_media` match as before

### 3. Updated image priority order
```text
1. BMS image_urls[0]     ← canonical product photo (highest priority)
2. company_media match   ← manually uploaded reference
3. Curated references    ← style/brand references
(max 4 images sent to Gemini)
```

### Technical Details
- `selectProductImageForPrompt()` return type changes from `ProductImage | null` to `{ product: ProductImage | null, bmsImageUrls: string[] }`
- The main pipeline collects BMS URLs and prepends them to `inputImages` array
- The "CRITICAL: first reference image is the EXACT product" instruction applies to BMS images when available
- No changes needed to `bms-agent` — it already passes through `image_urls` from the bridge

### Files Changed
| Action | File |
|--------|------|
| Edit | `supabase/functions/whatsapp-image-gen/index.ts` |

