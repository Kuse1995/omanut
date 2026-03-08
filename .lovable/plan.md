

# Fix Re-Index Function: Base64 Images + Timeout

## Problem
Two issues prevent the re-index from working:
1. **Gemini can't fetch Supabase storage URLs** — returns "Cannot fetch content from the provided URL"
2. **Function times out** — 10 images × ~5s each exceeds the default 30s timeout

## Changes

### 1. `supabase/functions/reindex-company-media/index.ts`
- **Download each image from storage** and convert to base64 before sending to Gemini
- Send as `inlineData` via the native Gemini API (`geminiChatJSON`) instead of passing a URL
- Reduce delay between images from 1000ms to 500ms

### 2. `supabase/functions/index-brand-asset/index.ts`
- Same fix: download image from storage → base64 → send inline to Gemini instead of URL

### 3. `supabase/config.toml`
- Add `timeout = 120` for `reindex-company-media` (10 images needs ~60-90s)

After deploying, I'll invoke the function again for Finch to index all 10 images.

| File | Change |
|------|--------|
| `supabase/functions/reindex-company-media/index.ts` | Fetch images as base64, send inline to Gemini |
| `supabase/functions/index-brand-asset/index.ts` | Same base64 fix |
| `supabase/config.toml` | Add timeout = 120 for reindex function |

