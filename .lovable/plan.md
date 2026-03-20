

# Fix: Video Duration (6s → 10s) + Audio Limitation

## Problem 1: Videos are 6 seconds instead of 10
The MiniMax API accepts a `duration` parameter (6 or 10 seconds). We're not sending it, so it defaults to 6. Fix: explicitly pass `duration: 10` in the payload.

## Problem 2: Videos have no sound
MiniMax Hailuo 2.3 produces **silent videos** — this is a model limitation, not a bug. No MiniMax model currently generates audio. To add sound, we need a post-processing step that generates background music or a voiceover and merges it with the video.

However, merging audio + video requires either ffmpeg (not available in edge functions) or an external video processing API. The most practical approach is to generate a background music track alongside the video and send both to the boss — the video file plus a separate audio track — or use a cloud video processing service to merge them.

For now, the immediate fix is the duration. For audio, we'd need to set up an audio generation service (e.g., ElevenLabs Music via connector) and a video+audio merge pipeline, which is a larger feature.

## Changes

### 1. `supabase/functions/_shared/minimax-client.ts`
- Add `duration` field to the payload, defaulting to `10` (seconds)
- Accept `duration` as an option parameter

### 2. `supabase/functions/boss-chat/index.ts`
- Update system prompt and tool description to note videos are 10 seconds
- Pass duration through to `minimaxStartVideoGeneration`

## Technical Detail

In `minimax-client.ts`:
```typescript
// Add to options interface
duration?: number;

// Add to payload construction
payload.duration = options.duration || 10;
```

Note: 1080P resolution caps at 6s max. Since we use 768P, 10s is supported.

## Files Modified
- `supabase/functions/_shared/minimax-client.ts` — add duration parameter
- `supabase/functions/boss-chat/index.ts` — update descriptions

