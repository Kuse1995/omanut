

# Unified Supervisor Architecture for Boss Chat

## Problem

Right now `boss-chat` has **two separate brains**:

1. **Hardcoded command detection** (lines 11-136, 196-296) — regex patterns that intercept image commands *before* the AI model ever sees them, routing directly to `whatsapp-image-gen`
2. **AI model with tools** (lines 960-1533) — the actual Gemini-powered supervisor that handles everything else via tool calling

This means image generation bypasses the supervisor entirely. The boss is effectively talking to a dumb regex parser for images and a smart AI for everything else. The experience feels fragmented.

## Solution: Let the Supervisor Handle Everything

Remove the hardcoded `detectImageGenCommand()` interception from `boss-chat`. Instead, give the AI model an `generate_image` tool (and an `edit_image` tool) so it can decide when to call image generation as part of its normal reasoning flow.

```text
BEFORE:
  Boss Message → Regex Check → [match?] → whatsapp-image-gen (bypasses AI)
                             → [no match] → AI Model → Tools

AFTER:
  Boss Message → AI Model (Supervisor) → Tools (including generate_image, edit_image, show_gallery)
```

## Changes

### `supabase/functions/boss-chat/index.ts`

1. **Remove the `detectImageGenCommand()` function** and its call (lines 11-136, 237-296). Remove the image generation interception block entirely.

2. **Add 3 new tools** to `managementTools` array:
   - `generate_image` — takes `prompt` string, calls `whatsapp-image-gen` with `messageType: 'generate'`
   - `edit_image` — takes `instructions` string, calls `whatsapp-image-gen` with `messageType: 'edit'`
   - `show_image_gallery` — no params, calls `whatsapp-image-gen` with `messageType: 'history'`

3. **Add tool handlers** in the `switch (functionName)` block for these 3 tools — same logic currently in the interception block (lines 257-295), just moved into tool execution.

4. **Update system prompt** (line 618-634) — remove the instruction telling the boss to use special commands. Instead tell the AI: "You can generate images directly using the generate_image tool. When the boss asks for any image, use this tool with a detailed prompt."

5. **Keep the `image help` response** (lines 196-234) but simplify it — the boss can now just describe what they want naturally.

## What This Achieves

- Boss talks to **one AI** that understands context and delegates internally
- "Generate an image of a boy drinking from the LifeStraw Family 2.0 in a Zambian living room and post it on Facebook and Instagram" becomes a **single conversation turn** where the AI chains: `generate_image` → `schedule_social_post` (with the generated image URL)
- No more fragmented regex parsing — the AI's intent detection is far superior
- The supervisor can combine image generation with other actions (schedule post, draft caption) in one multi-tool turn

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/boss-chat/index.ts` | Remove `detectImageGenCommand()` interception; add `generate_image`, `edit_image`, `show_image_gallery` tools; update system prompt |

