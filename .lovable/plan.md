

# Generate First Frame → Animate to Video Pipeline

## Problem
The video generation pipeline's fallback chain (media search, product profiles, logos) still produces inconsistent results because it uses raw library images as starting frames — not purpose-built "first frame" compositions. The existing image generation pipeline in `whatsapp-image-gen` has a sophisticated multi-agent system (Style Memory Agent, Reference Curator, Product Identity Locks, Exclusion Lists) that produces brand-accurate images. Video generation doesn't leverage any of this.

## Solution
When `generate_video` is called and no `input_image_url` is provided, automatically generate a first frame using the full `whatsapp-image-gen` pipeline, then pass that generated image into Veo as image-to-video.

```text
Current flow:
  Boss: "make a video of our water filter"
  → AI calls generate_video(prompt="water filter promo")
  → No inputImageUrl → fallback chain tries media library
  → Veo gets a random stock photo OR pure text → hallucinated product

New flow:
  Boss: "make a video of our water filter"  
  → AI calls generate_video(prompt="water filter promo")
  → No inputImageUrl found
  → System calls whatsapp-image-gen internally to generate first frame
    → Product Identity Lock activates
    → Reference Curator assembles brand assets
    → Style Memory applies learned preferences
    → Gemini generates accurate product image
  → Generated image stored + passed to Veo as image-to-video
  → Video shows the REAL product
```

## Changes

### 1. `supabase/functions/boss-chat/index.ts` — Video handler update
In the `generate_video` case, after all existing fallbacks fail (no `inputImageUrl` resolved), add a new step before calling `veoStartGeneration`:

- Call `whatsapp-image-gen` edge function internally with `messageType: 'generate'` and a first-frame-specific prompt derived from the video prompt
- Wait for the image URL to come back (synchronous — whatsapp-image-gen returns the URL)
- Use the returned image as `inputImageUrl` for Veo
- Log the auto-generated first frame for debugging

The prompt sent to image gen will be adapted: instead of the full video motion description, extract just the static scene/product description (e.g., "Professional product photo of [product] for video opening frame, centered composition, clean background").

Also add a prompt transformation step: take the video prompt (which describes motion) and convert it to a static first-frame prompt using a simple template.

### 2. System prompt update
Update the video generation section in the system prompt to inform the AI that:
- If no image is provided, the system will automatically generate a brand-accurate first frame
- The AI should still try to provide `input_image_url` when it has one, as it's faster

### 3. Tool description update
Update `generate_video` tool description to note automatic first-frame generation as a built-in capability.

## Technical Detail

New code in `generate_video` handler (after all existing fallbacks, before `veoStartGeneration`):

```typescript
// Final fallback: Generate a first frame using the image pipeline
if (!inputImageUrl) {
  console.log('[BOSS-VID] No image source found — generating first frame via image pipeline');
  try {
    const firstFramePrompt = `Professional product photo for video opening frame. ${videoPrompt.replace(/\b(animate|motion|zoom|pan|rotate|slide|transition|moving|flowing)\b/gi, '')}. Static composition, centered subject, clean background, studio lighting.`;
    
    const imgGenResponse = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/whatsapp-image-gen`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({
          companyId: company.id,
          customerPhone: '',
          conversationId: null,
          prompt: firstFramePrompt,
          messageType: 'generate',
        }),
      }
    );
    
    const imgGenResult = await imgGenResponse.json();
    if (imgGenResult.imageUrl) {
      inputImageUrl = imgGenResult.imageUrl;
      toolImageUrl = imgGenResult.imageUrl;
      console.log('[BOSS-VID] First frame generated:', inputImageUrl);
    }
  } catch (e) {
    console.error('[BOSS-VID] First frame generation failed:', e);
  }
}
```

This happens synchronously before the Veo call. Since `whatsapp-image-gen` typically takes 5-15 seconds and the edge function has a 120s timeout, there's ample time — the Veo call itself is async (returns immediately with an operation name).

### Checking `whatsapp-image-gen` return format
Need to verify that `whatsapp-image-gen` returns `imageUrl` in its JSON response when called server-to-server (not via WhatsApp delivery). Will check and potentially adjust to ensure it returns the generated image URL in the response body.

## Files Modified
- `supabase/functions/boss-chat/index.ts` — auto first-frame generation, updated tool description and system prompt

