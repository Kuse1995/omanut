

# Fix: PDF Delivery to Customer Failing (Twilio 400)

## What Happened

The PDF **was** generated successfully — the boss received it. But sending to the **customer** failed with Twilio 400 error.

## Root Cause

`customerPhone` already contains the `whatsapp:` prefix (e.g., `whatsapp:+260967254226`). At line 3888, the code wraps it again:

```typescript
To: `whatsapp:${customerPhone}`,   // → whatsapp:whatsapp:+260967254226 ❌
From: `whatsapp:${senderNumber}`,  // senderNumber may also already have prefix
```

This same pattern works correctly in `sendBossHandoffNotification` (line 686-691) which properly checks for existing prefix before adding it. But the auto-doc section doesn't do this check.

## Fix

In `supabase/functions/whatsapp-messages/index.ts`, update the Twilio send block (lines ~3887-3892) for customer PDF delivery:

1. **Strip existing prefix** before re-adding it for both `To` and `From` fields
2. **Log the Twilio error body** (currently only logs status code, not the error message) to aid future debugging

Same fix needed for the boss notification block at lines ~3922-3927.

```typescript
// Fix To/From prefix handling
const toNumber = customerPhone.startsWith('whatsapp:') ? customerPhone : `whatsapp:${customerPhone}`;
const fromNumber = senderNumber.startsWith('whatsapp:') ? senderNumber : `whatsapp:${senderNumber}`;
```

### Files Modified
- `supabase/functions/whatsapp-messages/index.ts` — fix `whatsapp:` prefix duplication in auto-doc Twilio sends (2 places: customer send + boss send)

