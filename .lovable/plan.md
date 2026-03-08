

# Fix: BMS Bridge Doesn't Support `list_quotations` / `list_invoices`

## Root Cause

The error is **not** in our code — our `bms-agent` forwards `list_quotations` to the external BMS API bridge (`hnyzymyfirumjclqheit.supabase.co/functions/v1/bms-api-bridge`), but that remote bridge returns `"Unknown action: list_quotations"`. The remote BMS system simply doesn't have this endpoint yet.

## Fix

Since the external BMS doesn't support listing past quotations/invoices, we need a graceful fallback in `boss-chat`:

1. **In `boss-chat/index.ts`** — Update the `list_quotations` / `list_invoices` handler (line ~1857): When the BMS returns "Unknown action", instead of showing the raw error, return a helpful message like:
   > "📋 The BMS doesn't support retrieving past quotations yet. I can create a new quotation for this client instead — just tell me the items and amounts."

2. **Update the system prompt** (line ~395): Change the PDF workflow instruction so the AI knows to fall back to `create_quotation` if `list_quotations` is unavailable, then generate the PDF from that result.

3. **Optionally remove `list_quotations` and `list_invoices`** from the tool definitions entirely (lines 888-917) to prevent the AI from calling an action that will always fail. Instead, the PDF workflow for quotations would be: `create_quotation` → `generate_document`.

### Recommended approach
Remove `list_quotations`/`list_invoices` tools and their handlers since the BMS doesn't support them. Update the system prompt to instruct: "To send a quotation PDF, first use `create_quotation` to create it, then `generate_document` to generate and send the PDF." This avoids a dead-end tool call entirely.

