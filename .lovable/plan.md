

# Fix: Cross-Company Product Contamination in Image Generation

## Problem

E Library (a Christian Digital Bookstore) is generating images showing LifeStraw water purifiers — a product belonging to Finch Investments Limited. This happens because:

1. E Library has **zero product identity profiles** and no `business_context` set
2. The auto-exclusion fallback adds text exclusions like "LifeStraw" and "water filter", but the image model ignores soft text constraints
3. E Library has only 1 product media item (its logo) — no visual product anchors exist
4. The user selected "Brand-only fallback" mode: generate brand scenes using logo/colors/business type, but never invent physical products

## Root Cause

The `whatsapp-image-gen` pipeline has no gate to prevent generation when a company lacks product identity profiles. It proceeds with whatever references it can find (just a logo), and the Gemini model hallucinates random physical products from training data.

## Solution: Brand-Only Fallback Mode

When a company has **no active product identity profiles**, switch the pipeline to "brand-only" mode:

- Generate scenes using only: company logo, brand colors, business type context
- Inject an explicit **"NO PHYSICAL PRODUCTS"** constraint into the prompt
- Never pass BMS product images or company_media products as references (they might be from shared/incorrect sources)

### Changes

#### 1. `supabase/functions/whatsapp-image-gen/index.ts` — Pipeline gate

In `runImagePipeline()` (around line 640), after loading product identity profiles:

```
// If NO product identity profiles exist AND no confident product match:
// → Switch to BRAND-ONLY mode
const brandOnlyMode = allProfiles.length === 0 && !productMatch;

if (brandOnlyMode) {
  // Clear all product references — use only logo + brand context
  bmsImageUrls = [];
  // Inject hard constraint into prompt
  const brandOnlyConstraint = `\n⛔ BRAND-ONLY MODE: This company has NO physical products to show. ` +
    `Do NOT depict any physical consumer products, water filters, bottles, electronics, or merchandise. ` +
    `Focus ONLY on: people, scenes, emotions, digital devices showing content, ` +
    `the company logo, and brand colors. The business is a "${businessType}". ` +
    `Create a scene that represents the brand's values and services without inventing products.\n`;
  // Prepend to user prompt
  userPrompt = brandOnlyConstraint + userPrompt;
}
```

Also in the input images assembly (around line 738-760):
- Skip BMS images entirely in brand-only mode
- Skip product match references in brand-only mode  
- Only pass logo references

#### 2. `supabase/functions/whatsapp-image-gen/index.ts` — Strengthen exclusion fallback

Expand the `businessTypeExclusions` map (around line 666-673) and add a **universal physical product exclusion** for companies without profiles:

```
if (allProfiles.length === 0) {
  effectiveExclusionList.push(
    'water filter', 'water purifier', 'LifeStraw', 'bottle', 
    'consumer product', 'physical merchandise', 'packaged goods'
  );
}
```

#### 3. `supabase/functions/boss-chat/index.ts` — System prompt update

Add to the image generation section (around line 318) a note that for companies without product profiles, the AI should describe *scenes and concepts* rather than products:

```
⚠️ BRAND-ONLY COMPANIES: If no product images exist in the library,
generate brand lifestyle scenes (people, emotions, digital devices)
— NEVER invent physical products that don't exist.
```

#### 4. Data fix: Set `business_context` for E Library

Update E Library's `image_generation_settings` to populate `business_context` so the pipeline has proper brand grounding:

```sql
UPDATE image_generation_settings 
SET business_context = 'E Library is a Christian digital bookstore selling ebooks for children. Focus on: families reading together, children learning, digital tablets showing ebooks, faith-based education, African family scenes.'
WHERE company_id = 'dddb3024-cf98-4fcb-9ee6-a93d93b9f515';
```

## Files Modified
- `supabase/functions/whatsapp-image-gen/index.ts` — brand-only pipeline gate + strengthened exclusions
- `supabase/functions/boss-chat/index.ts` — system prompt update for brand-only companies
- Database migration — set E Library's `business_context`

