

# Fix: Image Delivery Using Wrong Sender Number

## Root Cause

The `whatsapp-image-gen` callback code sends WhatsApp messages using `company.twilio_number` as the From address. For the "E Library" company, `twilio_number` is `+260967254226` — which is the **boss's personal phone number**, not the Twilio WhatsApp sender. This means every callback tries to send FROM the boss TO the boss (same number), which Twilio silently rejects.

The correct sender is `company.whatsapp_number` (`whatsapp:+14647686485`), which is what `whatsapp-messages` uses successfully everywhere else.

## Fix

In `supabase/functions/whatsapp-image-gen/index.ts`, change all boss notification Twilio calls to use `whatsapp_number` instead of `twilio_number`:

1. **Line 1441** (post auto-publish success notification): Change `select('twilio_number')` to `select('whatsapp_number')` and update the From line.
2. **Line 1477** (post image gen failure notification): Same change.
3. **Line 1502** (standalone boss image delivery): Same change.
4. **Line 1527** (standalone boss image failure notification): Same change.

Each location follows the same pattern — select `whatsapp_number` from companies, then use it with the `startsWith('whatsapp:')` guard as From, matching the pattern used in `whatsapp-messages`.

This is 4 nearly identical edits in one file, ~2 lines each.

