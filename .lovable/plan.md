

# Fix: Veo Not Being Called + Videos Are Horizontal

## Problem 1: Veo not used despite config saying "veo"
The database has `video_provider = 'veo'` for your company, and the code already has the correct branching logic (line 2590-2614). The most recent logs show MiniMax was used — this means the edge function running in production hasn't picked up the latest deployment with the Veo branching code. 

**Fix**: Force redeploy `boss-chat` edge function. No code change needed — the logic is already correct.

## Problem 2: Videos are horizontal instead of vertical
The tool definition tells the AI to default to 9:16, but the AI model is free to pass `16:9` explicitly. Two fixes:

### `supabase/functions/boss-chat/index.ts`
- **Override the aspect ratio** — ignore whatever the AI passes and always use `9:16` unless the boss explicitly said "landscape" or "widescreen" in their message. Change line 2416 from:
  ```typescript
  const aspectRatio = args.aspect_ratio || '9:16';
  ```
  to:
  ```typescript
  const aspectRatio = '9:16'; // Always vertical for social media
  ```
- Update the tool description to remove the `enum` choices entirely and just hardcode the explanation that all videos are vertical 9:16.

Alternatively, keep the option but make the system prompt more forceful about defaulting vertical.

### Approach chosen: Hardcode 9:16, remove aspect_ratio from tool params
Since the primary use case is Facebook/Instagram Reels, hardcode vertical. If landscape is ever needed, it can be re-added later.

## Files Modified
- `supabase/functions/boss-chat/index.ts` — hardcode 9:16 aspect ratio, remove `aspect_ratio` from tool params
- Redeploy `boss-chat` to pick up Veo branching + aspect ratio fix

