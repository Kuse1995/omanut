
## Explore (what’s actually failing)
- The PDF **is being generated and uploaded** successfully (confirmed by logs: `[GENERATE-DOC] PDF generated...`).
- The failure is in the **WhatsApp delivery step** inside `supabase/functions/generate-document/index.ts`.
- Current code builds the Twilio “From” like this:
  - `const fromNumber = company.twilio_number || company.whatsapp_number;`
  - `formData.append("From", \`whatsapp:${fromNumber}\`)`
- If `company.whatsapp_number` is already stored as `whatsapp:+...` (common in this codebase), this becomes:
  - `From = whatsapp:whatsapp:+...` → Twilio rejects it as invalid.
- Additionally, `boss-chat` currently **always claims** “PDF generated and sent to your WhatsApp” even when `whatsapp_sent` is false, so the UX is misleading.

## Design (how we should handle WhatsApp numbers)
Use the same normalization pattern already used elsewhere (e.g. `send-boss-notification`, `send-whatsapp-message`):
- If number starts with `whatsapp:` → keep as-is
- Else → prefix with `whatsapp:`
Also prefer `company.whatsapp_number` for WhatsApp sending, falling back to `company.twilio_number` only if needed.

## Plan (implementation steps)
### 1) Fix Twilio “From” formatting in `generate-document`
**File:** `supabase/functions/generate-document/index.ts`

- Change WhatsApp delivery block to:
  - Prefer `company.whatsapp_number` (then fallback to `company.twilio_number`)
  - Normalize `From` like:
    - `from = raw.startsWith("whatsapp:") ? raw : "whatsapp:" + raw`
  - Keep existing boss phone normalization to E.164 `+...`, then `To = whatsapp:+...`
- Add a small log line (safe) showing normalized `From`/`To` (masked or partial) and Twilio status code to make future debugging immediate.

### 2) Make boss chat response truthful + provide fallback link
**File:** `supabase/functions/boss-chat/index.ts` (tool handler: `generate_document`)

- After calling `generate-document`, use returned fields:
  - `docResult.whatsapp_sent`
  - `docResult.pdf_url`
- Response rules:
  - If `success && whatsapp_sent`: keep current “sent to WhatsApp” message.
  - If `success && !whatsapp_sent`: say “PDF generated but couldn’t be delivered to WhatsApp” + include the `pdf_url` so the boss can download immediately.
  - If `!success`: keep failure message with `docResult.error`.

### 3) (Optional but recommended) Align other boss-message sends with E.164 formatting
**File:** `supabase/functions/send-boss-notification/index.ts` (and any other Twilio sends that use `boss_phone`)
- Ensure `To` always uses `whatsapp:+{number}` (add `+` when missing), same as `generate-document` already does.
- This prevents intermittent delivery failures for any boss notifications, not just PDFs.

## Testing (end-to-end)
1) Trigger “create a quotation” from Boss WhatsApp.
2) Confirm:
   - Boss receives a WhatsApp message with the PDF attachment (or at least a working link if Twilio media fails).
   - `generate-document` logs show Twilio request is `200` (or show a clear error cause).
   - Boss-chat no longer claims “sent” when it wasn’t.

## Files involved
- `supabase/functions/generate-document/index.ts` (primary fix)
- `supabase/functions/boss-chat/index.ts` (correct messaging + fallback)
- (Optional hardening) `supabase/functions/send-boss-notification/index.ts`

## Expected outcome
- PDFs continue generating as before.
- WhatsApp delivery succeeds consistently (no more invalid `From` formatting).
- Even if WhatsApp delivery fails for other reasons (media fetch, provider limits), the boss still gets a usable download link and accurate status.
