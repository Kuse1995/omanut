

# Fix: Force Image-to-Video in Video Generation Pipeline

## Problem

When the boss requests a video, the AI model often calls `generate_video` with only a text prompt, without passing `input_image_url`. The fallback only checks the `generated_images` table (last 30 min of AI-generated images). If nothing is found there, Veo runs as pure text-to-video and hallucinates random products.

## Root Cause

There's no automatic media library lookup for video generation. The image generation pipeline has product identity matching and brand asset lookups, but the video pipeline has none — it relies entirely on either:
1. The AI model passing `input_image_url` (unreliable)
2. A recently generated image existing in `generated_images` (situational)

## Solution

Add a **mandatory image source fallback chain** in the `generate_video` handler. Before calling Veo, if no `inputImageUrl` is resolved, search the company's media library for a relevant product image using the video prompt as a semantic search query.

### Changes to `supabase/functions/boss-chat/index.ts`

**In the `generate_video` case handler (around line 2434-2475):**

After the existing `getLatestRecentImage` fallback fails, add two more fallback layers:

1. **Semantic media library search** — Use the video prompt to search `company_media` via the existing `match_company_media` RPC (same one used by `search_media` tool). Pick the highest-relevance product image.

2. **Product identity profile fallback** — Query `product_identity_profiles` for the company and use the first product's reference image URL.

3. **Logo fallback** — If still nothing, find the company logo from `company_media` where `category = 'logo'`.

If ALL fallbacks fail (company has zero media), proceed with text-to-video but inject the brand-only constraint into the prompt (similar to the image generation brand-only mode).

```
Fallback chain:
1. args.input_image_url (AI provided)
2. toolImageUrl from earlier in conversation  
3. getLatestRecentImage (last 30 min generated images)
4. NEW: Semantic search company_media using video prompt
5. NEW: First product_identity_profile reference image
6. NEW: Company logo from company_media
7. Text-to-video with brand-only prompt constraint
```

**Also update the system prompt** (video generation section, ~line 329):

Add stronger instruction:
```
- MANDATORY: Before calling generate_video, ALWAYS call search_media or list_product_images 
  first to find a relevant product image. Then pass that URL as input_image_url.
  The system has a fallback, but AI-selected images produce better results.
```

**Update the `generate_video` tool description** (~line 1233):

Change to emphasize that `input_image_url` is effectively required:
```
"Generate a short product video (8 seconds). CRITICAL: You MUST provide input_image_url 
whenever possible. Before calling this, search the media library (search_media) to find 
a relevant product/brand image and pass its URL. Image-to-video produces dramatically 
better results than text-to-video."
```

### Technical Detail

New fallback code in `generate_video` handler (after line 2444):

```typescript
// Fallback 2: Semantic search company media library
if (!inputImageUrl) {
  try {
    const queryEmbedding = await embedQuery(videoPrompt);
    const vectorStr = `[${queryEmbedding.join(',')}]`;
    const { data: mediaResults } = await supabase.rpc('match_company_media', {
      query_embedding: vectorStr,
      match_company_id: company.id,
      match_threshold: 0.25,
      match_count: 3,
    });
    const imageMedia = mediaResults?.find((m: any) => 
      m.media_type?.startsWith('image') || m.file_path?.match(/\.(jpg|jpeg|png|webp)$/i)
    );
    if (imageMedia) {
      inputImageUrl = `https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/${imageMedia.file_path}`;
      console.log('[BOSS-VID] Using media library image as video source:', inputImageUrl);
    }
  } catch (e) {
    console.error('[BOSS-VID] Media search fallback failed:', e);
  }
}

// Fallback 3: Product identity profile reference
if (!inputImageUrl) {
  const { data: profiles } = await supabase
    .from('product_identity_profiles')
    .select('reference_image_urls')
    .eq('company_id', company.id)
    .eq('is_active', true)
    .limit(1);
  const refUrl = profiles?.[0]?.reference_image_urls?.[0];
  if (refUrl) {
    inputImageUrl = refUrl;
    console.log('[BOSS-VID] Using product profile reference as video source:', inputImageUrl);
  }
}

// Fallback 4: Company logo
if (!inputImageUrl) {
  const { data: logos } = await supabase
    .from('company_media')
    .select('file_path')
    .eq('company_id', company.id)
    .eq('category', 'logo')
    .limit(1);
  if (logos?.[0]) {
    inputImageUrl = `https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/${logos[0].file_path}`;
    console.log('[BOSS-VID] Using company logo as video source:', inputImageUrl);
  }
}
```

## Files Modified
- `supabase/functions/boss-chat/index.ts` — media library fallback chain, updated tool description, updated system prompt

