

# Fix: Use gemini-3.1-flash-image Consistently

Two places still reference the old `gemini-2.5-flash-image` model:

| File | Line | Current | Fix |
|------|------|---------|-----|
| `supabase/functions/auto-content-creator/index.ts` | 149 | `model: 'gemini-2.5-flash-image'` | `model: 'gemini-3.1-flash-image'` |
| `supabase/functions/_shared/gemini-client.ts` | 75 | `options.model \|\| 'gemini-2.5-flash-image'` | `options.model \|\| 'gemini-3.1-flash-image'` |

Two-line change across two files. All other functions already use `gemini-3.1-flash-image`.

