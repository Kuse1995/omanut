

# Fix Finch Purchase Flow — Two Root Causes

## Problem
When a customer asks to buy a product and requests a Lenco payment link, the AI either:
1. Returns the generic fallback "Thank you for your patience. Someone will respond shortly."
2. Previously returned "Thank you for your message. How can I help you today?" repeatedly

## Root Causes

### 1. `max_tool_rounds` is too low (2 vs 3 needed)
Finch's `company_ai_overrides.max_tool_rounds` is set to **2**, but the autonomous checkout flow requires **3** sequential tool calls:
- Round 1: `check_stock` (verify availability + get price)
- Round 2: `record_sale` (log transaction + get receipt reference)
- Round 3: `generate_payment_link` (create Lenco URL using reference)

The loop exits after round 2, leaving no payment link generated. The AI has no content to reply with, so the fallback fires.

### 2. Fallback message is a vague handoff
Finch's configured `fallback_message` is: *"Thank you for your patience. Someone will respond shortly."* — this makes it look like the AI gave up and handed off to a human, when in reality it just ran out of tool rounds.

## Fix

### Database change — Update Finch's AI config
```sql
UPDATE company_ai_overrides 
SET max_tool_rounds = 4,
    fallback_message = 'I apologize for the delay. Could you please repeat your request? I''m here to help! 🙏'
WHERE company_id = '5b9503c3-36e7-41a2-b64f-2657a8bf4e83';
```

### Code change — `supabase/functions/whatsapp-messages/index.ts`
Add a minimum floor of **3** for `max_tool_rounds` when checkout tools are enabled, so the checkout chain can always complete regardless of database config:

```typescript
// Line ~3116: After reading max_tool_rounds from config
let maxToolRounds = Math.min(aiOverrides?.max_tool_rounds || 3, 5);

// Ensure at least 3 rounds when checkout tools are active
const hasCheckoutTools = enabledToolNames.includes('check_stock') && 
                         enabledToolNames.includes('record_sale') && 
                         enabledToolNames.includes('generate_payment_link');
if (hasCheckoutTools && maxToolRounds < 3) {
  console.log(`[TOOL-LOOP] Bumping max_tool_rounds from ${maxToolRounds} to 3 for checkout flow`);
  maxToolRounds = 3;
}
```

| Target | Change |
|--------|--------|
| Database (`company_ai_overrides`) | Set `max_tool_rounds = 4` and improve fallback message for Finch |
| `supabase/functions/whatsapp-messages/index.ts` | Add minimum floor of 3 tool rounds when checkout tools are enabled |

