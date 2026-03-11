

# Bypass Image Quality Assessment (Temporary)

## Problem

The quality assessment agent's JSON parsing consistently fails, causing a fallback score of 5/10 which is below the 7.0 threshold. Every generated image gets rejected even though the images themselves are fine.

## Change

In `supabase/functions/whatsapp-image-gen/index.ts`, modify the pipeline to **skip the quality assessment entirely** and accept the first generated image. Specifically:

1. **Lines 670-698**: Replace the quality assessment call and retry loop logic with a direct pass-through. After generating and uploading the image, immediately accept it with score 10 and `pass: true`.
2. Set `effectiveMaxRetries` to 0 (line 567) so only one generation attempt runs — no retries needed without assessment.

This is a ~15-line change in the pipeline loop. The quality assessment function code stays in place (just unused) so it can be re-enabled later.

