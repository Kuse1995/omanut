

# Fix: Remove Duplicate Tool Definitions in boss-chat

## Root Cause

The edge function logs show the exact error:
```
Lovable AI API error: Duplicate function declaration found: list_quotations
```

In `boss-chat/index.ts`, `list_quotations` and `list_invoices` are defined **twice** in the tools array (lines 888-917 and again at lines 919-950). The AI gateway rejects the request with a 400 error, so the boss gets no response.

## Fix

Remove the duplicate block at **lines 919-950** (the second `list_quotations` + `list_invoices` definitions), keeping only the first set at lines 888-917.

Then redeploy `boss-chat`.

