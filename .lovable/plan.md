
Goal: make AI image sending reliable again in WhatsApp.

What I found
- `supabase/functions/whatsapp-messages/index.ts` has two separate `send_media` paths. The first/background path has invalid-URL recovery, but the later multi-round tool-loop path does not. So later-round AI sends can still fail even after the earlier fix.
- Both paths build the Twilio `To` number as `whatsapp:${customerPhone}` instead of using a shared normalizer. Project memory already warns that inconsistent WhatsApp prefixing can trigger Twilio 400 errors.
- Media signing is still brittle: current logic mostly depends on URLs containing `/company-media/`. If the tool passes a different storage representation, the function can end up with 0 signed URLs and no real media delivery.

Implementation
1. Create shared media-send helpers inside `supabase/functions/whatsapp-messages/index.ts`
   - `normalizeWhatsAppTo/From`
   - `resolveMediaRefs` to accept public URLs, signed URLs, and storage file paths
   - `recoverMediaFromLibrary` using the existing vector -> text -> recent fallback
   - `dispatchMediaToWhatsApp` to sign URLs, send sequentially, attach `StatusCallback`, and return structured success/failure

2. Replace both `send_media` branches to use the same helper
   - the initial/background tool-call branch
   - the multi-round tool-loop branch  
   This removes the current mismatch so auto-recovery, signing, normalization, and error handling all work the same way.

3. Harden the tool contract
   - Keep the “never invent URLs” instruction
   - Make `search_media` return canonical `file_path` alongside `url`
   - Let `send_media` accept canonical storage refs and prefer them over guessed URLs  
   This reduces dependence on fragile URL parsing.

4. Make failure handling truthful
   - Only store/send “[Sent …]” assistant markers when at least one Twilio media request succeeds
   - Return explicit failure results when zero files were signed or zero sends succeeded
   - Keep `media_delivery_status` inserts only for real queued sends, with better Twilio error-body logging for rejected requests

5. Parity hardening
   - Reuse the same phone normalization approach in `supabase/functions/send-whatsapp-message/index.ts` so manual sends and AI sends behave consistently

Validation after approval
- Trigger a real WhatsApp request like “send me the product pics”
- Confirm the customer receives an actual image attachment, not only text
- Confirm `media_delivery_status` moves through `queued`/`delivered`
- If Twilio still rejects, inspect the improved error logs to identify the exact rejection reason

Technical details
- Main file: `supabase/functions/whatsapp-messages/index.ts`
- Secondary parity file: `supabase/functions/send-whatsapp-message/index.ts`
- No database migration required
