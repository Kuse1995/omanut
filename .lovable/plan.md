

# Make BMS More Effective Without Breaking What Works

## Issues Found

**1. Missing `company_id` in customer-facing BMS calls**
In `whatsapp-messages/index.ts` line 3376, the BMS call sends params without `company_id`:
```typescript
body: JSON.stringify({ action: bmsToolName, params: bmsParams })
// bmsParams never includes company_id
```
The bms-agent logs confirm: `Company: undefined`. It only works today because of the global `BMS_API_SECRET` env fallback. This breaks multi-tenant completely.

**Fix:** Add `company_id: company.id` to `bmsParams` before the fetch call (1 line, line ~3370).

**2. `get_product_details` fails — not supported by Finch bridge**
The bms-agent logs show repeated failures: `"Unknown action: get_product_details"`. The `AVAILABLE_ACTIONS` list in `bms-agent/index.ts` includes it, but the Finch BMS bridge doesn't implement it. The AI keeps calling it and getting errors.

**Fix:** Remove `get_product_details` from `AVAILABLE_ACTIONS` in bms-agent until the bridge supports it. Also remove the `get_product_details` tool definition from `whatsapp-messages` so the AI stops trying to use it.

**3. `list_products` tool missing from customer BMS routing**
The mandatory checkout tools list (line 2177) doesn't include `list_products`, so when a customer asks "what do you sell?", the AI can't call it even though the BMS supports it.

**Fix:** Add `list_products` to the `mandatoryCheckoutTools` array and to the BMS tool execution switch block.

**4. Same `current_stock`/`unit_price` field mapping issue exists here**
The raw BMS response goes straight to the AI as JSON. The AI then interprets whatever fields exist. Unlike boss-chat which formats manually, here the AI gets the raw data — so it should actually work IF the fields are present. But we should ensure the tool descriptions mention the correct field names so the AI knows what to look for.

## Changes

### `supabase/functions/whatsapp-messages/index.ts`
- **Line ~3370**: Inject `company_id: company.id` into `bmsParams` before the fetch
- **Line ~2177**: Add `list_products` to `mandatoryCheckoutTools`  
- **Line ~3349**: Add `list_products` to the BMS tool routing list
- **Line ~3356**: Add `list_products` case to the switch block
- Remove `get_product_details` tool definition if present (AI uses `check_stock` instead)

### `supabase/functions/bms-agent/index.ts`
- Remove `get_product_details` from `AVAILABLE_ACTIONS` (Finch bridge doesn't support it — causes 100% failure rate)

These are surgical fixes — no changes to the AI prompts, tool architecture, or checkout flow.

