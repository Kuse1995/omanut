

# Add Video Provider Switch (Veo ↔ MiniMax)

## Overview
Add a `video_provider` column to `company_ai_overrides` so you can switch between `minimax` and `veo` per company — from the admin deep settings UI. No code redeployment needed.

## Changes

### 1. Database migration — Add `video_provider` column
Add a `video_provider` text column to `company_ai_overrides`, defaulting to `'minimax'`.

```sql
ALTER TABLE public.company_ai_overrides 
ADD COLUMN video_provider text NOT NULL DEFAULT 'minimax';
```

### 2. `supabase/functions/boss-chat/index.ts` — Read provider from config
Where the function fetches `company_ai_overrides`, include `video_provider` in the select. Then in the `generate_video` tool handler, use it to decide whether to call MiniMax or Veo:

- If `minimax`: current MiniMax path (unchanged)
- If `veo`: call `veoStartGeneration` from `gemini-client.ts` and store `video_provider: 'veo'` in the job row

The polling function (`poll-video-generation`) already handles both providers based on the `video_provider` column in the job row — no changes needed there.

### 3. `src/components/admin/deep-settings/ModelConfigPanel.tsx` — Add video provider selector
Add a new card below the Voice Model section with a simple dropdown:

- **MiniMax Hailuo 2.3** — $0.32/video, 768P, supports image-to-video and text-to-video
- **Google Veo** — Higher quality, uses Gemini API key

Wired to `video_provider` field in `AIConfig` / `company_ai_overrides`.

### 4. `src/components/admin/AIDeepSettings.tsx` — Add `video_provider` to AIConfig type
Add `video_provider: string` to the `AIConfig` interface and include it in the default config and save logic.

## Files Modified
- Database migration (new column)
- `supabase/functions/boss-chat/index.ts` — read config, branch on provider
- `src/components/admin/deep-settings/ModelConfigPanel.tsx` — UI dropdown
- `src/components/admin/AIDeepSettings.tsx` — type + default

