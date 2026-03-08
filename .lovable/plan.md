

# Fix Product Matching: Add Visual/Multimodal Selection

## Problem

`selectProductImageForPrompt` matches products using only **text metadata** (file_name, tags, description). It never actually looks at the product images themselves. This is why matching fails — metadata is often generic or incomplete, but the images contain all the visual information needed to identify the product.

## Solution

Upgrade the matcher to be **multimodal**: send the actual product image thumbnails to Gemini Vision alongside the text catalog, so the AI can visually identify which product the user is asking about — just like Google Reverse Image Search would.

## Changes

### File: `supabase/functions/whatsapp-image-gen/index.ts`

**Refactor `selectProductImageForPrompt`:**

1. After fetching product images from `company_media`, construct **public URLs** for each image using the existing `getMediaPublicUrl` helper.

2. Build a **multimodal prompt** that includes:
   - Each product image as an `image_url` content part (up to 10 candidates to stay within token limits)
   - A text catalog listing each image's index, name, tags, and description
   - The user's prompt/request
   - BMS inventory context (unchanged)

3. Send to `gemini-2.5-flash` (text+vision model, NOT the image generation model) with multimodal content:
   ```
   messages: [{
     role: 'user',
     content: [
       { type: 'text', text: selectionPrompt },
       { type: 'image_url', image_url: { url: productUrl1 } },
       { type: 'image_url', image_url: { url: productUrl2 } },
       ...
     ]
   }]
   ```

4. The AI now **sees** the actual products and can match based on visual similarity (labels, logos, colors, shape) — not just filename guesses.

5. Keep the keyword fallback as a last resort if the multimodal call fails.

6. Cap candidates at 10 images. If more exist, pre-filter using the existing keyword scorer to pick the top 10 candidates before sending to vision.

### Prompt update

```
You are a product image matcher with vision capabilities.
A user wants to generate a marketing image for a specific product.
Look at the product images below and match the one that best fits their request.

USER REQUEST: "{prompt}"

PRODUCT CATALOG:
1. Name: "LifeStraw Family", Tags: [water, filter], Description: "..."
2. Name: "Solar Panel Kit", Tags: [solar, energy], Description: "..."
...

{BMS inventory context if available}

INSTRUCTIONS:
- LOOK at each image carefully — match based on what you SEE (product shape, branding, labels, colors)
- Use the text metadata as supplementary context only
- If NO product visually matches, respond "NONE"
- Respond with ONLY the product number (e.g. "1") or "NONE"
```

### Files

| Action | File |
|--------|------|
| Edit | `supabase/functions/whatsapp-image-gen/index.ts` — refactor `selectProductImageForPrompt` to multimodal |

