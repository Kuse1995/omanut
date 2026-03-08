

# Upgrade Vision/Indexing Models to Gemini 3.0

## What
Replace all `gemini-2.5-flash` references used for **visual analysis and indexing** with `gemini-3-flash-preview` across 6 edge functions. Image **generation** stays on `gemini-3-pro-image-preview` (unchanged).

## Files and Changes

| File | Current Model | New Model | Purpose |
|------|--------------|-----------|---------|
| `supabase/functions/index-brand-asset/index.ts` (line 23) | `gemini-2.5-flash` | `gemini-3-flash-preview` | Product indexing on upload |
| `supabase/functions/reindex-company-media/index.ts` (line 23) | `gemini-2.5-flash` | `gemini-3-flash-preview` | Bulk re-indexing |
| `supabase/functions/analyze-media/index.ts` (line 42) | `gemini-2.5-flash` | `gemini-3-flash-preview` | Media category/tag analysis |
| `supabase/functions/analyze-customer-image/index.ts` (line 84) | `gemini-2.5-flash` | `gemini-3-flash-preview` | Payment proof / customer image analysis |
| `supabase/functions/whatsapp-image-gen/index.ts` (lines 354, 593, 652) | `gemini-2.5-flash` | `gemini-3-flash-preview` | Product matching, caption gen, suggestions |

Note: The two indexing functions (`index-brand-asset`, `reindex-company-media`) call the native Gemini REST API directly (not via `geminiChat`), so the model name in the URL path will be updated from `gemini-2.5-flash` to `gemini-3-flash-preview`.

No other changes needed — same API format, same response structure.

