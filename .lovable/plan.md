

# Fix & Test: BMS Agent Phase 1 & 2

## Problem Found

The edge functions haven't been redeployed with the Phase 1/2 changes. When I tested, the deployed `bms-agent` still only knows the original 7 actions. Additionally, `boss-chat/index.ts` has a **syntax error** — an orphaned code block (lines 1925-1957) that was part of `show_image_gallery` lost its `case` label, causing a parse failure that blocks deployment.

## Test Results So Far

| Action | Result |
|--------|--------|
| `list_products` | **PASS** — returned 5+ products with prices, stock, images |
| `check_stock` (soap) | **PASS** — returned empty (no product named "soap") |
| `get_company_statistics` | **FAIL** — function not deployed (old version running) |

## Fix Required

### `supabase/functions/boss-chat/index.ts`
**Line 1924**: Insert `case 'show_image_gallery': {` before the orphaned block at line 1925. The code from lines 1925-1957 is valid `show_image_gallery` logic that lost its case label during Phase 2 edits.

## After Fix — Deploy & Test

Redeploy all 4 updated functions: `bms-agent`, `bms-callback`, `boss-chat`, `whatsapp-messages`.

Then test each action:

| # | Action | Payload |
|---|--------|---------|
| 1 | `get_company_statistics` | `{"company_id": "finch-limited"}` |
| 2 | `get_product_variants` | `{"product_name": "LifeStraw Go - Two Stage Filter", "company_id": "finch-limited"}` |
| 3 | `create_order` | `{"customer_name": "Test User", "customer_phone": "+260971234567", "items": [{"product_name": "Lifestraw Family", "quantity": 1}], "company_id": "finch-limited"}` |
| 4 | `get_order_status` | `{"order_number": "<from #3>", "company_id": "finch-limited"}` |
| 5 | `sales_report` | `{"start_date": "2026-03-01", "end_date": "2026-03-08", "company_id": "finch-limited"}` |
| 6 | `get_customer_history` | `{"customer_phone": "+260971234567", "company_id": "finch-limited"}` |
| 7 | `create_quotation` | `{"client_name": "Test Client", "items": [{"description": "LifeStraw Family", "quantity": 2, "unit_price": 730}], "company_id": "finch-limited"}` |
| 8 | `create_invoice` | `{"client_name": "Test Client", "items": [{"description": "LifeStraw Family", "quantity": 1, "unit_price": 730}], "company_id": "finch-limited"}` |
| 9 | `get_low_stock_items` | `{"company_id": "finch-limited"}` |
| 10 | `record_expense` | `{"category": "Transport", "vendor_name": "Uber", "amount_zmw": 150, "company_id": "finch-limited"}` |
| 11 | `get_expenses` | `{"start_date": "2026-03-01", "end_date": "2026-03-08", "company_id": "finch-limited"}` |
| 12 | `get_outstanding_receivables` | `{"company_id": "finch-limited"}` |
| 13 | `get_outstanding_payables` | `{"company_id": "finch-limited"}` |
| 14 | `profit_loss_report` | `{"start_date": "2026-01-01", "end_date": "2026-03-08", "company_id": "finch-limited"}` |
| 15 | `clock_in` | `{"employee_name": "John Doe", "company_id": "finch-limited"}` |
| 16 | `clock_out` | `{"employee_name": "John Doe", "company_id": "finch-limited"}` |
| 17 | `create_contact` | `{"sender_name": "Jane", "sender_email": "jane@test.com", "message": "I want to buy filters", "company_id": "finch-limited"}` |

