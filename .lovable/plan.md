

# Fix: Image Generation Wrong Products, AI Going Quiet, and Images Never Delivered

## The 3 Issues You're Experiencing

### Issue 1: Wrong Product Generated Despite Reference Image
**Root cause: `get_product_details` still being called in product selection (line 899, 929)**

We removed `get_product_details` from `bms-agent`'s `AVAILABLE_ACTIONS` last session, but `selectProductImageForPrompt()` in `whatsapp-image-gen/index.ts` still calls it at lines 899 and 929. This call now **always fails** ("Unknown action"), meaning:
- `bmsImageUrls` is always empty (no BMS product images as anchors)
- `bmsContext` is always empty (no inventory cross-reference)
- The vision matcher works with company_media images only, but without BMS anchoring, the "HARD GEOMETRY LOCK" has no authoritative source image

Additionally, the quality assessment agent has a **silent failure path** (line 554): when `safeParseJSON` throws on the AI's response, it returns `{ score: 7, pass: true }` — auto-passing bad images. The logs confirm this happens frequently:
```
[QUALITY-ASSESS] Assessment failed: Error: No JSON object found in response
[PIPELINE] Quality check PASSED (score: 7/10)
```

**Fix:**
- Replace `get_product_details` calls with `check_stock` (which actually works and returns product data)
- In quality assessment fallback, return `pass: false` with `score: 5` so bad images get retried instead of auto-passed

### Issue 2: AI Goes Quiet (No Response)
**Root cause: boss-chat times out → 520 error → whatsapp-messages throws → empty TwiML returned**

The logs show the exact chain:
```
[BOSS-TOOL-generate_image] Timeout or error: Image generation timed out  (45s timeout)
→ boss-chat continues to round 2 with more generate_image calls
→ second image gen also times out
→ boss-chat itself exceeds Edge Function time limit → 520 error
→ whatsapp-messages catches: "FunctionsHttpError: Edge Function returned a non-2xx status code"
→ throws "Boss chat failed" → empty TwiML returned → user sees nothing
```

The 45-second timeout for `generate_image` in boss-chat (line 1803) is too short — the pipeline takes 30-60+ seconds with the 6-agent system. When the AI chains 3 `generate_image` calls in sequence (as shown in logs), that's 3×45s minimum, causing boss-chat to hit Supabase's 150s function timeout.

**Fix:**
- When `generate_image` times out in boss-chat, **fire-and-forget** the image generation and tell the AI it's generating in background — don't let it retry in the next tool round
- Return a concrete tool result: `"Image is generating asynchronously. Tell the boss it will arrive shortly."` instead of the vague `"I'll send it when ready"`
- Add `scheduledPostId` and `bossPhone` to the async call so the image gets delivered via WhatsApp when done
- Reduce `generate_image` timeout to 30s (if it hasn't finished in 30s, it won't finish in 45s either — go async)

### Issue 3: "You Will Receive an Image" But It Never Arrives
**Root cause: The async fire-and-forget has no delivery mechanism for standalone images**

When boss-chat's `generate_image` times out (line 1836-1838), it sets:
```typescript
result = { success: true, message: '🎨 Image is being generated in the background. I\'ll send it when ready!' };
```

But the actual `whatsapp-image-gen` call that was fired has `customerPhone: ''` and no `bossPhone` parameter. The auto-publish callback (lines 1428-1514) only triggers when `scheduledPostId` is present. For standalone image generation (not for a post), there is **no callback mechanism** to deliver the image to the boss when it completes.

**Fix:**
- Add a `bossPhone` parameter to the `whatsapp-image-gen` function
- When `bossPhone` is set and `scheduledPostId` is NOT set (standalone generation), send the completed image directly to the boss via Twilio at the end of generation
- Pass `bossPhone: company.boss_phone` in the boss-chat `generate_image` timeout fallback

## Changes

### File: `supabase/functions/whatsapp-image-gen/index.ts`

1. **Lines 896-918 and 926-931**: Replace `get_product_details` BMS calls with `list_products` (which the bridge supports). Pass the prompt as a search term.

2. **Lines 550-554 (quality assessment fallback)**: Change auto-pass to auto-fail:
   ```typescript
   // Was: { score: 7, pass: true, ... }
   // Now: { score: 5, pass: false, issues: [...], retryPrompt: 'Try again with clearer product focus' }
   ```

3. **Lines 1428-1514 (end of main handler)**: Add a new delivery path — when `bossPhone` is set and no `scheduledPostId`, send the image to the boss via Twilio WhatsApp.

### File: `supabase/functions/boss-chat/index.ts`

4. **Lines 1803-1841 (`generate_image` tool handler)**: 
   - Reduce timeout from 45s to 30s
   - On timeout: fire an async `whatsapp-image-gen` call with `bossPhone: company.boss_phone` so the image gets delivered when ready
   - Return a definitive tool result that prevents the AI from retrying image gen in the next round
   - Add a `_imageGenInProgress` flag check — if a previous round already timed out on image gen, skip subsequent image gen calls and tell the AI to use a placeholder or wait

### File: `supabase/functions/_shared/gemini-client.ts`
No changes needed.

## What This Fixes

- **Wrong products**: Product selection will actually get BMS data instead of always-failing `get_product_details`, AND bad images won't silently pass quality checks
- **AI going quiet**: Boss-chat won't cascade-timeout from sequential image gen calls; it'll go async immediately on first timeout
- **Images never arriving**: Standalone image generations will have a delivery callback to send the completed image to the boss via WhatsApp

