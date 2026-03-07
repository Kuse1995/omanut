

# Plan: Add `check_stock` and `record_sale` BMS Tools

## What to do

Add two new tool declarations to the `allToolDefinitions` map in `supabase/functions/whatsapp-messages/index.ts`, right after the existing `lookup_product` tool (line 1731).

### Tools to add

**1. `check_stock`** — Checks real-time inventory/pricing from BMS
- `product_name` (string, required)

**2. `record_sale`** — Records a completed sale in BMS
- `product_name` (string, required)
- `quantity` (integer, required)
- `payment_method` (string, enum: cash/mobile_money/bank_transfer/card, required)
- `customer_name` (string, optional)
- `customer_phone` (string, optional)

### File changed

| File | Change |
|---|---|
| `supabase/functions/whatsapp-messages/index.ts` | Insert two new entries in `allToolDefinitions` after line 1731 (after `lookup_product`) |

No tool handlers will be wired up yet — declarations only, as requested.

