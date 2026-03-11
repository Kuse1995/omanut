

# Fix Trigger-Happy Image Generation Detection

## Problem
The `detectImageGenCommand` function in `whatsapp-messages/index.ts` is far too aggressive:

- **Overly broad patterns**: Words like "add", "remove", "change", "make" trigger image generation even in normal conversation ("add me to the list", "make a reservation")
- **No recency check on feedback**: "nice one", "love it", "perfect", "👍" always trigger image gen feedback — the comment says "only after recent image generation" but no actual check exists
- **No company gate**: Image generation fires before checking if the company even has it enabled
- **Edit patterns too broad**: "crop", "resize", "add text" match normal conversation

## Fix — Three Changes

### 1. Add company-level gate before detection
Before calling `detectImageGenCommand`, query `image_generation_settings` to check if the company has image gen enabled. If not, skip detection entirely.

### 2. Tighten trigger patterns
- **Generate**: Require explicit image keywords — keep `generate/create/design image of` but remove standalone "make" (too common)
- **Edit**: Require preceding image context or the ✏️ emoji — remove standalone "add/remove/change/crop/resize"
- **Feedback**: Only trigger if the last AI message in the conversation (within 5 minutes) was an image. Query `generated_images` table for a recent entry
- **Suggestions**: Remove "post idea" and "suggest a post" from image gen — these should go through the regular AI which can decide whether to generate

### 3. Add explicit opt-in prefix requirement for ambiguous commands
Keep `🎨`, `image:`, `img:` as unambiguous triggers. For natural language patterns like "generate an image of...", "create a picture of...", require the word "image/picture/photo/graphic" to be present.

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/whatsapp-messages/index.ts` | Add image_generation_settings check before detection (~line 703), tighten `detectImageGenCommand` patterns (~lines 50-140), add recency check for feedback type |

