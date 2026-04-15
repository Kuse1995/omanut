
<final-text>Do I know what the issue is? Yes. The main bug is in `supabase/functions/whatsapp-messages/index.ts`: the first `send_media` path exists, but in the multi-round tool loop all non-BMS tools are replaced with a fake generic success message instead of actually running. Since the AI is instructed to do `search_media` first and `send_media` after that, the image send usually happens in round 2, so WhatsApp gets the text reply (“Shared! You’ll see...”) but no actual attachment. There is also a secondary hardening issue: the “official library” URL validation is too brittle and can falsely reject valid storage URLs.</final-text>

## Fix plan

### 1) Repair the media tool flow
Update `supabase/functions/whatsapp-messages/index.ts` to extract media handling into shared helpers and use the same real execution path in:
- the initial tool-call pass
- the later multi-round tool loop

Instead of this current behavior in later rounds:
```text
search_media -> send_media -> generic “tool executed” ack
```
it will become:
```text
search_media -> send_media -> actual Twilio media dispatch
```

### 2) Add a reusable `sendMedia` helper
In `supabase/functions/whatsapp-messages/index.ts`, create a helper that:
- validates official-library URLs correctly
- converts library URLs to signed storage URLs
- sends media sequentially to WhatsApp
- logs Twilio response bodies on failure
- returns real success/failure data back into the tool result

This keeps behavior consistent with the existing multi-image delivery rule.

### 3) Harden official-library validation
Replace the current hostname-only check (`supabase.co`) with validation based on the company media bucket/storage path so valid library URLs do not get rejected as “fake URLs”.

### 4) Wire delivery tracking already present in the backend
Reuse the existing backend pieces already in the project:
- `media_delivery_status` table
- `twilio-status-webhook`
- `retry-failed-media`

When media is sent from `whatsapp-messages`, store a delivery row and attach `StatusCallback` so we can see whether Twilio queued, delivered, failed, or returned an error code.

### 5) Prevent false success copy
Only let the assistant say media was shared if the send actually succeeded. If media send fails, return a truthful fallback like:
```text
I found the images, but I couldn’t deliver them right now.
```
instead of pretending the images arrived.

## Files to update
- `supabase/functions/whatsapp-messages/index.ts`
- possibly `supabase/functions/send-whatsapp-message/index.ts` for parity/hardening if manual outbound media should use the same signed-URL + delivery-tracking logic

## Technical notes
- No database migration is required; the delivery table and webhook already exist.
- The cleanest implementation is to move the current first-round `search_media` / `send_media` logic into shared functions and call them from both execution phases.
- After implementation, I’ll verify end-to-end by checking that a customer asks for samples, the attachment actually appears in WhatsApp, and backend delivery status shows queued/delivered instead of silent text-only replies.
