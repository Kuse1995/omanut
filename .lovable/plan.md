

# Fix: Credit Addition & WhatsApp Message Blocking

## Root Cause Analysis

**Both issues are connected.** Omanut Technologies has **0 credits**, and the `whatsapp-messages` function blocks all AI responses when `credit_balance <= 0` (line 5441), returning "Our assistant is currently offline." So WhatsApp messages ARE arriving (confirmed in logs) but the AI won't respond.

The credit addition likely failed because someone entered an extremely large number — the database logs show: `value "1000000000000000" is out of range for type integer`. The `add_credits` RPC parameter `p_amount` is typed as `int4` (max ~2.1B), and the UI has no validation cap.

Additionally, the `BillingPanel` shows a generic "Failed to add credits" toast without the actual error message, making debugging impossible.

## Fix Plan

### 1. Add input validation in `BillingPanel.tsx`
- Cap the credit input at a reasonable maximum (e.g., 1,000,000)
- Show the actual error message from Supabase when the RPC fails
- Add `max` attribute to the input field

### 2. Immediately add credits to Omanut via migration
- Run a one-time SQL migration to set Omanut's credit balance to a reasonable amount (e.g., 10,000 credits) so WhatsApp messages start flowing again immediately

### 3. Improve error feedback in `BillingPanel.tsx`
- Display `error.message` in the toast so admins can see what went wrong

## Files to Edit

| File | Change |
|------|--------|
| `src/components/admin/BillingPanel.tsx` | Add max validation (1,000,000), show error details in toast |
| Database migration | Set Omanut credit_balance to 10,000 |

