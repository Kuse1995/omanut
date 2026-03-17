

# Fix: AI Claiming It Cannot Generate Videos

## Problem
The system prompt in `boss-chat/index.ts` has a strong instruction for images: "NEVER say you cannot generate images. Use the generate_image tool directly." But there is no equivalent instruction for video generation. The AI model falls back to its training belief that it cannot create videos, despite having the `generate_video` tool available.

## Fix

### `supabase/functions/boss-chat/index.ts`

Update the video generation section (around line 309-315) to add an explicit instruction mirroring the image one:

```
10. **Video Generation**: You can create short product videos using the generate_video tool!
    - Use when the boss asks for a video, reel, or animated content for social media.
    - NEVER say you cannot generate videos. Use the generate_video tool directly.
    - PRIORITIZE IMAGE-TO-VIDEO: ...
    (rest stays the same)
```

Also add video to the general "capabilities" reminder near the top of the prompt where it lists what the assistant can do, reinforcing that video generation is a real capability.

Single file change, ~3 lines added.

