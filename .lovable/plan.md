

# Why LifeStraw Products Appear in E Library Images — Root Cause

## Diagnosis

The image generation pipeline **correctly filters by company** — all queries use `.eq('company_id', companyId)`. The cross-contamination is not a code bug. It's a **data gap**.

**E Library's current state:**
- **1 product image** with generic description "Product image for AI generation" and zero tags
- **0 Product Identity Profiles** (the table is completely empty — never used)
- **No business_context or style_description** in image generation settings
- **No exclusion keywords** to block competitor products

Without strong anchors, the AI model has almost nothing to ground E Library's visual identity. It falls back on its general knowledge and possibly bleeds context from other companies' generations.

## Fix — Three Actions

### 1. Create Product Identity Profiles for E Library
Run `extract-product-identity` on E Library's product image to generate a structured visual fingerprint. Then add exclusion keywords like `["LifeStraw", "Finch", "water filter", "water purifier"]` so the pipeline explicitly blocks those terms.

### 2. Re-index E Library's product image
The single product image has the generic "Product image for AI generation" description. Run `reindex-company-media` for E Library so Gemini Vision generates a proper description and tags. This gives the product matcher real context.

### 3. Set business_context in image_generation_settings
Update E Library's `image_generation_settings` row with a clear business context like: "Christian digital bookstore selling ebooks. Products are digital books with cover art. NEVER generate water filters, water purification products, or any physical products." This gets injected into every generation prompt.

## Implementation

| Change | Method |
|--------|--------|
| Update `image_generation_settings.business_context` for E Library | SQL migration or admin UI update |
| Create product identity profiles with exclusion keywords | Call `extract-product-identity` edge function + update exclusions |
| Re-index E Library media | Call `reindex-company-media` edge function |
| Add auto-exclusion logic in pipeline | Code change in `whatsapp-image-gen` — when no product identity profiles exist, inject company `business_type` as a negative anchor |

The most impactful immediate fix is updating the `business_context` field and adding exclusion keywords. The code change would add a safety net: if a company has zero product identity profiles, the pipeline auto-generates a basic exclusion prompt from the company's `business_type` to prevent unrelated product categories from appearing.

