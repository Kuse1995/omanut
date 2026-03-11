

# Reduce Image Quality Assessment Threshold to 7.0

## Change

In `supabase/functions/whatsapp-image-gen/index.ts`, line 542:

**Current:** Product images require 8.5, non-product requires 7.5
**New:** Both use a unified 7.0 threshold

Additionally, relax the per-criterion hard-fail for product images from "below 7" to "below 5" to match the more lenient overall threshold — otherwise the individual criterion check would be stricter than the pass threshold itself.

## File

| File | Change |
|---|---|
| `supabase/functions/whatsapp-image-gen/index.ts` | Line 542: `passThreshold = 7.0` (unified). Line 533: relax per-criterion product fail from `< 7` to `< 5`. |

Single file, two line changes. Deploy automatically.

