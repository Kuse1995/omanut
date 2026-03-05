

## Plan: Pass Boss's Image Description to Image Generator

### Problem
The `schedule_facebook_post` tool has no parameter for the boss's specific image description. When the boss says "I want an image to be of Zambian preteens reading in a Bible study", the AI sets `needs_image_generation: true` but the actual image prompt sent to `whatsapp-image-gen` (line 998) is just:

```
"Create a brand-aligned image for this Facebook post: [caption text]"
```

The caption text ("Uncover the heroes of the past...") has nothing to do with what the boss wanted the image to look like. The specific image instruction is discarded.

### Fix

**File: `supabase/functions/boss-chat/index.ts`**

1. **Add `image_prompt` parameter** to the `schedule_facebook_post` tool definition (line 761):
   ```typescript
   image_prompt: { type: "string", description: "Detailed description of what the generated image should depict, extracted from the boss's message. E.g., 'Zambian preteens reading in a Bible study'" }
   ```

2. **Use `image_prompt` in the image generation call** (line 998):
   ```typescript
   // Replace:
   prompt: `Create a brand-aligned image for this Facebook post: ${args.content}`
   // With:
   prompt: args.image_prompt || `Create a brand-aligned image for this Facebook post: ${args.content}`
   ```

This ensures the boss's specific image instructions are passed through to the image generator instead of just the post caption.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/boss-chat/index.ts` | Add `image_prompt` param to tool definition + use it in image gen call |

