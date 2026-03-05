

## Plan: Redeploy Edge Functions to Restore WhatsApp Responsiveness

### Problem
No messages (boss or customer) are being recorded since March 5. The `whatsapp-messages` and `boss-chat` edge functions show zero logs, meaning they are not receiving or processing any webhook requests. This happened after the last code edit to `boss-chat/index.ts`.

The most likely cause is a failed or stale deployment. Edge functions need to be redeployed.

### Fix

**Step 1: Redeploy the affected edge functions**
- `whatsapp-messages` (the main webhook handler)
- `boss-chat` (the management AI function)

No code changes are needed. The existing code is syntactically valid. This is a deployment issue that will be resolved by triggering a fresh deploy of both functions.

**Step 2: Verify deployment**
After redeployment, check edge function logs to confirm both functions are booting and processing requests.

### Additional cleanup (minor, same edit session)

**File: `supabase/functions/whatsapp-messages/index.ts`** (lines 3929-3936)

Remove the duplicate `boss_conversations` insert. Currently, `whatsapp-messages` inserts a record with no response (line 3930), and then `boss-chat` inserts another record with the response (line 1083). This creates orphaned rows with `response: null`. Remove the insert from `whatsapp-messages` since `boss-chat` already handles it.

### Files Changed

| Action | File |
|--------|------|
| Deploy | `supabase/functions/whatsapp-messages/index.ts` |
| Deploy | `supabase/functions/boss-chat/index.ts` |
| Edit | `supabase/functions/whatsapp-messages/index.ts` — remove duplicate boss_conversations insert |

