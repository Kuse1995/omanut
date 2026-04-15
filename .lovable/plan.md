

## Fix: Bulk Auto-Link Returns 0 Because AI Responses Are Truncated

### Root Cause
The `analyze-media` edge function sets `max_tokens: 500`, which is too small when BMS product lists are included in the prompt. The AI's JSON response gets cut off mid-way, the regex parser finds an incomplete `{` without a closing `}`, throws "No JSON found in response", and falls back to a generic response with no `bms_product_id`. Every single call is failing — visible in the logs as repeated parse errors.

### Fix (1 file: `supabase/functions/analyze-media/index.ts`)

1. **Increase `max_tokens` from 500 to 1024** — enough for the full JSON response including BMS matching fields.

2. **Fix JSON parsing to handle markdown fences and truncation**:
   - Strip `` ```json ``` `` wrappers before regex matching
   - If the closing `}` is missing (truncated), attempt to repair by closing open strings/arrays/objects
   - As a last-resort partial parse: extract individual fields with targeted regexes (`"bms_product_id"\s*:\s*"([^"]+)"`)

3. **Add `bms_product_id` extraction to the fallback path** — even if full JSON parsing fails, try to extract any `bms_product_id` the AI mentioned before truncation, so partial matches aren't lost.

4. **Add `response_format: { type: "json_object" }` to the Gemini call** if supported by the gateway, to eliminate markdown wrapping entirely.

### Expected Result
After deployment, running "Auto-Link All to BMS" will successfully parse AI responses and match images to BMS products. The 31 currently unlinked ANZ media items should get linked where matches exist.

### Technical Detail
- Single file change: `supabase/functions/analyze-media/index.ts`
- No database migration needed
- Deploy via edge function deployment

