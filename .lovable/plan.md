

## Plan: Add Image Generation Awareness to Boss-Chat System Prompt

### Problem
The phone conflict is resolved (you removed the duplicate). The remaining issue is that the AI told the boss it "can't generate or display images" because the **system prompt** (lines 546-591) never mentions image generation capabilities. Image generation is handled by regex pattern matching *before* the AI sees the message, so the AI model itself has no idea it can do images.

### Fix

**File: `supabase/functions/boss-chat/index.ts`**

Add a new capability block after item 7 (Content Scheduling, line 572) in the system prompt:

```
8. **Image Generation**: You CAN generate brand-aligned images directly in this WhatsApp chat!
   When the boss asks for an image, tell them to use commands like:
   - "Generate an image of [description]" or "🎨 [description]"
   - "Edit: [changes]" to modify the last image
   - "Show my images" to view recent creations
   NEVER say you cannot generate, create, or display images. You absolutely can.
   The image generation system handles it automatically when the boss uses these commands.
```

This ensures that when the boss asks conversationally (e.g., "Can you make me an image?"), the AI responds with guidance on how to use the image commands instead of claiming it can't do it.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/boss-chat/index.ts` | Add image generation capability description to system prompt (~line 573) |

