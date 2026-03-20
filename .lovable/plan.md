

# Switch to MiniMax-Hailuo-2.3-Fast + Default Vertical (9:16)

## Changes

### 1. `supabase/functions/_shared/minimax-client.ts`
- Change default model from `MiniMax-Hailuo-2.6-Fast` to `MiniMax-Hailuo-2.3-Fast` (line 27)
- Set default resolution to `768P` instead of `720P` (line 36)
- Default to vertical 9:16 aspect ratio for social media reels — pass `"9:16"` as the aspect ratio in the payload when no specific ratio is given

### 2. `supabase/functions/boss-chat/index.ts`
- Update the default `aspectRatio` from `'9:16'` (already correct on line 2416) — confirm it stays as 9:16
- Update the system prompt video section (~line 331) to note that videos default to vertical 9:16 for Facebook/Instagram Reels
- Update tool description to mention vertical-first default for social posting

## Technical Detail

In `minimax-client.ts`, the payload update:
```typescript
const model = options.model || 'MiniMax-Hailuo-2.3-Fast';
payload.resolution = '768P';
```

Cost drops from ~$0.50+ per video (2.6 Fast) to $0.32 per 768P 10s video.

## Files Modified
- `supabase/functions/_shared/minimax-client.ts` — model + resolution change
- `supabase/functions/boss-chat/index.ts` — system prompt + tool description updates

