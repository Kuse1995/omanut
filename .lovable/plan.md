

# Plan: Hardcode Demo Boss Number +260972064502

## Overview

Set `+260972064502` as the hardcoded boss number for the demo WhatsApp line. This number will:
1. Be recognized as the boss for all demo commands (DEMO, ERASE, ACT AS, STATUS)
2. Receive human handoff notifications when the demo AI determines it needs human intervention

## Changes

### 1. `supabase/functions/demo-session/index.ts`

**Hardcode the boss number** instead of relying on `boss_phone` passed from the company record:

```text
const DEMO_BOSS_PHONE = '+260972064502';
const isBoss = senderPhone === DEMO_BOSS_PHONE;
```

**Add handoff detection** in the AI customer response flow. When the AI's response contains a handoff signal (e.g., customer asks for a real person, complex issue), send a WhatsApp notification to `+260972064502` with the conversation context, then reply to the customer that a human will be in touch.

The handoff logic:
- Add an instruction in the AI system prompt: "If the customer explicitly asks to speak to a human or has a complex issue you cannot resolve, include [HANDOFF_REQUIRED] in your response."
- After getting the AI response, check for `[HANDOFF_REQUIRED]`
- If found: send a notification to the boss number via the `send-whatsapp-message` function with the customer's phone and conversation summary
- Reply to the customer with a friendly "connecting you to a human" message

### 2. `supabase/functions/whatsapp-messages/index.ts`

No changes needed here -- the routing intercept already passes `boss_phone` but the demo-session function will now ignore it and use the hardcoded value instead.

## Technical Details

### Handoff Notification to Boss

When `[HANDOFF_REQUIRED]` is detected in the AI response:

```text
POST to send-whatsapp-message with:
  to: +260972064502
  message: "[DEMO HANDOFF] Customer {phone} needs human help.
            Demo company: {demo_company_name}
            Last message: {customer_message}
            AI assessment: {stripped AI response}"
```

### Files Modified

| File | Change |
|------|--------|
| `supabase/functions/demo-session/index.ts` | Hardcode boss as +260972064502, add handoff detection and notification |

