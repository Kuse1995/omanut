

# Smart Product Lookup for Image Generation

## Problem
When the boss asks to generate an image of a specific product (e.g., "Generate an image of LifeStraw Family"), the system uses naive keyword matching (`selectProductImageForPrompt`) to find the product photo in `company_media`. This frequently picks the wrong item because it just counts word overlaps in filenames/tags. The AI image generator then produces inaccurate results because it's anchored to the wrong product photo.

Additionally, the boss has no way to browse uploaded product images to verify what's available.

## Solution

### 1. Replace keyword matching with AI-powered product selection
**File: `supabase/functions/whatsapp-image-gen/index.ts`**

Replace `selectProductImageForPrompt` with an AI-powered function that:
- Fetches all product images from `company_media` (category = 'products')
- Also queries BMS via `bms-api-bridge` (`check_stock`) to get real product names, SKUs, and details
- Sends the boss's prompt + the list of available products (names, descriptions, tags, BMS data) to Gemini Flash as a structured tool call
- Gemini returns the exact product ID match (or "none" if no match)
- This ensures accurate product selection even with vague or partial names

### 2. Add `list_products` tool to boss-chat
**File: `supabase/functions/boss-chat/index.ts`**

Add a new tool `list_product_images` to `managementTools`:
- No required parameters (optional `category` filter)
- Queries `company_media` for the company's uploaded product images
- Returns a formatted list showing: name, description, tags, and the image URL
- Lets the boss say "Show me my product images" to see what's available before requesting generation

### 3. Add BMS product cross-reference to image generation
**File: `supabase/functions/whatsapp-image-gen/index.ts`**

In the `generate` case, before selecting a product image:
- Call `bms-api-bridge` with `check_stock` using the product name from the prompt
- Use the BMS response (exact product name, SKU) to improve the AI product-matching prompt
- This connects inventory data with the media library for precise matching

### 4. Update boss system prompt
**File: `supabase/functions/boss-chat/index.ts`**

Add to the system prompt capabilities:
- "Use `list_product_images` to show the boss their uploaded product photos before generating images"
- "When the boss asks to generate an image, suggest they check available product photos first if results have been inaccurate"

## Technical Details

**AI product selection prompt (replaces keyword matching):**
```
Given this user request: "[boss prompt]"
And these available product images:
1. ID: abc, Name: "LifeStraw Family", Tags: [water filter, family], Description: "Blue water purifier"
2. ID: def, Name: "LifeStraw Go", Tags: [water bottle, portable], Description: "Personal water bottle"

BMS inventory match: "Lifestraw Family" (SKU: LSF, Stock: 90)

Which product image ID best matches? Return the ID or "none".
```

**`list_product_images` tool response format:**
```
📸 Your Product Images (5 total):

1. LifeStraw Family
   Tags: water filter, family, purifier
   🔗 [View Image]

2. LifeStraw Go
   Tags: bottle, portable, hiking
   🔗 [View Image]
```

**Files changed:**
- `supabase/functions/whatsapp-image-gen/index.ts` — Replace `selectProductImageForPrompt` with AI-powered selection + BMS cross-reference
- `supabase/functions/boss-chat/index.ts` — Add `list_product_images` tool + handler + system prompt update

