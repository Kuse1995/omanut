

# Fix: Generate Context-Specific First Frame via Nano Banana

## Problem
The fallback chain finds ANY image from the media library before the first-frame generator runs. When a user asks for a "LifeStraw Steel Bottle video", the semantic search returns the LifeStraw Family 2.0 image (the closest match in the library), and that static white-background image becomes the video's first frame. The `whatsapp-image-gen` auto-generation (which would create a proper, context-specific composition) never executes because the media library always returns *something*.

## Solution
Restructure the fallback chain: **always generate a fresh first frame using Nano Banana** when the AI doesn't explicitly provide `input_image_url`. Use media library images only as *reference context* for the generation, not as the actual first frame.

New flow:
```text
1. AI provides input_image_url → use it directly
2. toolImageUrl from earlier in conversation → use it directly  
3. Everything else → Generate first frame via Nano Banana (Lovable AI gateway)
   - Use media library search results as REFERENCE context in the prompt
   - Product Identity Locks still apply via prompt enrichment
   - Creative variation system ensures uniqueness
```

Instead of calling `whatsapp-image-gen` (which has its own complex pipeline and may not return a clean URL), call the Lovable AI gateway directly with `google/gemini-3-pro-image-preview` (Nano Banana Pro). This is simpler, faster, and gives us direct control over the first-frame prompt.

## Changes

### `supabase/functions/boss-chat/index.ts` — Restructure video image sourcing

**Remove fallbacks 2, 3, 4** (media library search, product profile, logo) as direct image sources (lines 2447-2511).

**Replace with**: A single Nano Banana image generation step that:
1. Searches media library for context (product names, descriptions) — but does NOT use the raw image URL
2. Queries product identity profiles for brand constraints (colors, labels, shapes)
3. Builds a rich first-frame prompt incorporating: the user's video request, product identity details, and creative variation
4. Calls Lovable AI gateway (`google/gemini-3-pro-image-preview`) to generate the first frame
5. Uploads the generated base64 image to `company-media` storage
6. Uses that uploaded URL as `inputImageUrl` for MiniMax

**Remove the old `whatsapp-image-gen` fetch call** (lines 2513-2575) — replaced by the direct Nano Banana call above.

### Technical Detail

```typescript
// After checking args.input_image_url and toolImageUrl...
if (!inputImageUrl) {
  console.log('[BOSS-VID] Generating context-specific first frame via Nano Banana');
  
  // Gather product context (for prompt enrichment, NOT as the image source)
  let productContext = '';
  try {
    const queryEmbedding = await embedQuery(videoPrompt);
    const vectorStr = `[${queryEmbedding.join(',')}]`;
    const { data: mediaResults } = await supabase.rpc('match_company_media', {
      query_embedding: vectorStr, match_company_id: company.id,
      match_threshold: 0.3, match_count: 3,
    });
    if (mediaResults?.length) {
      productContext = mediaResults.map(m => m.description || m.file_path).join('; ');
    }
  } catch (e) { /* non-fatal */ }

  // Get product identity constraints
  let identityContext = '';
  try {
    const { data: profiles } = await supabase
      .from('product_identity_profiles')
      .select('product_name, hex_colors, label_text, packaging_shape, exclusion_keywords')
      .eq('company_id', company.id).eq('is_active', true).limit(3);
    if (profiles?.length) {
      identityContext = profiles.map(p => 
        `Product: ${p.product_name}, Colors: ${p.hex_colors?.join(',')}, Label: ${p.label_text}, Shape: ${p.packaging_shape}`
      ).join('\n');
    }
  } catch (e) { /* non-fatal */ }

  // Creative variation
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
  const angle = pick([...angles]);
  const light = pick([...lighting]);
  // ... (same variation arrays as current code)

  const firstFramePrompt = `Generate a professional product photo for a video opening frame.
Product/scene requested: ${videoPrompt}
Company: ${company.name} (${company.business_type || 'business'})
${identityContext ? `Brand identity:\n${identityContext}` : ''}
Style: ${angle}, ${light}, ${bg}, ${comp}
CRITICAL: Show the EXACT product described. Do NOT substitute with a different product.`;

  // Call Lovable AI gateway directly
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-3-pro-image-preview',
      messages: [{ role: 'user', content: firstFramePrompt }],
      modalities: ['image', 'text'],
    }),
  });

  const aiData = await aiRes.json();
  const base64Url = aiData.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  
  if (base64Url) {
    // Upload to storage
    const base64Data = base64Url.replace(/^data:image\/\w+;base64,/, '');
    const imageBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    const filePath = `first-frames/${company.id}/${crypto.randomUUID()}.png`;
    await supabase.storage.from('company-media').upload(filePath, imageBytes, { contentType: 'image/png' });
    const { data: pub } = supabase.storage.from('company-media').getPublicUrl(filePath);
    inputImageUrl = pub.publicUrl;
    toolImageUrl = inputImageUrl;
    console.log('[BOSS-VID] ✅ First frame generated and uploaded:', inputImageUrl);
  }
}
```

## Files Modified
- `supabase/functions/boss-chat/index.ts` — replace static media fallbacks with Nano Banana first-frame generation

