

# Fix: Retry Video with Fallback Model When First Frame Fails

## Root Cause
When Nano Banana fails to generate a first frame (credits, errors, etc.), `inputImageUrl` stays null. `MiniMax-Hailuo-2.3-Fast` is image-to-video only, so it rejects the request. The error is caught but no retry happens — the AI then independently calls `generate_image` which sends you the image but never feeds it into a video.

## Solution — Two changes

### 1. `supabase/functions/_shared/minimax-client.ts` — Auto-switch model when no image
When `inputImageUrl` is absent, automatically use `MiniMax-Hailuo-2.3` (standard model that supports text-to-video) instead of `MiniMax-Hailuo-2.3-Fast` (image-to-video only).

```typescript
// Current (line 28):
const model = options.model || 'MiniMax-Hailuo-2.3-Fast';

// New:
const model = options.model || (options.inputImageUrl ? 'MiniMax-Hailuo-2.3-Fast' : 'MiniMax-Hailuo-2.3');
```

This ensures a video is ALWAYS generated — with the Fast model when we have an image, with the standard model (text-to-video) when we don't.

### 2. `supabase/functions/boss-chat/index.ts` — Remove company name from first-frame prompt (line 2506)
Remove `Company: ${company.name}` to stop "Omanut Technologies" from appearing in generated images. Product identity context already provides brand details.

## Files Modified
- `supabase/functions/_shared/minimax-client.ts` — auto-select model based on image availability
- `supabase/functions/boss-chat/index.ts` — remove company name pollution from first-frame prompt

