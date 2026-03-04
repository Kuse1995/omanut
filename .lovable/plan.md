

## Add 15-Second Delay Before Posting AI Reply

**What**: Add a `setTimeout` delay in the `meta-webhook` edge function's background processing, so the AI reply is posted ~15 seconds after receiving the comment — making it appear more human and avoiding Meta's bot filters.

**Change**: In `supabase/functions/meta-webhook/index.ts`, inside the `handleComment` function, add `await new Promise(resolve => setTimeout(resolve, 15000))` right before the Facebook Graph API POST request (after AI reply generation, before posting).

