

# Diagnosis: Two Separate Issues

## Issue 1: Image Generation Not Working

**Root Cause Found:** The `gemini-client.ts` routes image models to Google's native API (`generativelanguage.googleapis.com`) using model names like `gemini-3-pro-image-preview` and `gemini-2.5-flash-image-preview`. These are **Lovable Gateway aliases**, not valid Google API model names. The direct Gemini API migration broke image generation because Google's API does not recognize these model identifiers.

**Evidence:** The most recent E Library post (`1d337625`) was published with `image_url: null`. Earlier posts that DO have images were likely created before the migration. The `whatsapp-image-gen` function shows zero logs, meaning either the call fails silently or the AI never triggered it.

**Affected Functions:**
- `whatsapp-image-gen/index.ts` — uses `gemini-3-pro-image-preview` and `gemini-2.5-flash-image-preview`
- `auto-content-creator/index.ts` — uses `gemini-3-pro-image-preview`
- `generate-business-image/index.ts` — uses `gemini-2.5-flash-image-preview`

**Fix:** Update `gemini-client.ts` to route image generation models through the Lovable AI Gateway (`https://ai.gateway.lovable.dev/v1/chat/completions` with `LOVABLE_API_KEY`) instead of Google's native API. Text models continue using direct Gemini. This is a single-file change in the shared client — all functions will automatically work.

```text
geminiChat() call flow:

Before (broken):
  isImageModel? → Google native API → model not found → no image

After (fix):
  isImageModel? → Lovable Gateway → returns base64 image → works
```

## Issue 2: Finch WhatsApp (+260766195857) — Single Tick

Single tick means the message is sent from the phone but **not delivered to WhatsApp servers** or **not acknowledged by Twilio**. This is NOT a code issue. Possible causes:

- The Twilio number is in sandbox mode and the sandbox session expired (72h inactivity)
- The number is suspended or restricted on Twilio's side
- The webhook URL was updated but the number's messaging service configuration wasn't saved

**No code change needed.** You need to:
1. Check if the Finch number is a sandbox or production number in Twilio
2. If sandbox: re-join by sending the join keyword to the number
3. If production: check the number's status in Twilio Console → Phone Numbers → Active Numbers

## Implementation Plan

1. **Update `_shared/gemini-client.ts`** — Add a Lovable Gateway path for image models. When `isImageModel()` returns true, call `ai.gateway.lovable.dev` with `LOVABLE_API_KEY` instead of Google's native endpoint. Keep the same response reshaping so all callers remain compatible.

2. **No changes to any other edge function** — They all use `geminiChat()` from the shared client, so the fix propagates automatically.

