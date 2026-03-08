

# Phase 2: Operations, Finance & HR — Complete BMS Coverage

## Gap Analysis

Comparing the BMS API reference against current implementation, these actions are **missing**:

| # | Action | Category | Target |
|---|--------|----------|--------|
| 1 | `record_multi_sale` | Sales | Boss |
| 2 | `get_low_stock_items` | Inventory | Boss |
| 3 | `record_expense` | Finance | Boss |
| 4 | `get_expenses` | Finance | Boss |
| 5 | `get_outstanding_receivables` | Finance | Boss |
| 6 | `get_outstanding_payables` | Finance | Boss |
| 7 | `profit_loss_report` | Finance | Boss |
| 8 | `clock_in` | HR | Boss |
| 9 | `clock_out` | HR | Boss |
| 10 | `create_contact` | Website | Customer |

Also need fixes:
- `sales_report` uses `date_from/date_to` but BMS expects `start_date/end_date`
- `update_order_status` missing `tracking_number` param
- `bms-callback` missing `new_contact` event handler

## Files to Change

### 1. `supabase/functions/bms-agent/index.ts`
Add 10 new switch cases with validation. Fix `sales_report` param names (`start_date`/`end_date`). Add `tracking_number` to `update_order_status`. Update `available_actions` list.

### 2. `supabase/functions/boss-chat/index.ts`
- Add 9 new tool definitions (all boss-only): `record_multi_sale`, `get_low_stock_items`, `record_expense`, `get_expenses`, `get_outstanding_receivables`, `get_outstanding_payables`, `profit_loss_report`, `clock_in`, `clock_out`
- Add tool handlers with formatted emoji responses for each
- Update system prompt capabilities section

### 3. `supabase/functions/whatsapp-messages/index.ts`
- Add `create_contact` tool definition (customer-facing: "Submit a contact inquiry")
- Add handler that calls bms-agent
- Update complexity classifier regex to include `expense|invoice|payable|receivable|contact|inquiry`

### 4. `supabase/functions/bms-callback/index.ts`
- Add `new_contact` event handler (notifies boss of new website inquiry)

### 5. `.lovable/plan.md`
- Update to mark Phase 2 complete

## New Action Details

**`record_multi_sale`**: Required: `items[]`, `customer_name`, `payment_method`. Optional: `customer_email`, `customer_phone`, `notes`, `receipt_number`.

**`get_low_stock_items`**: No required params. Returns products below reorder level.

**`record_expense`**: Required: `category`, `vendor_name`, `amount_zmw`. Optional: `date_incurred`, `notes`.

**`get_expenses`**: Optional: `start_date`, `end_date`, `category`, `limit`.

**`get_outstanding_receivables`**: No params. Returns unpaid invoices + total.

**`get_outstanding_payables`**: No params. Returns pending vendor bills + total.

**`profit_loss_report`**: Required: `start_date`, `end_date`. Returns revenue, expenses, net profit, margin.

**`clock_in` / `clock_out`**: Required: `employee_name` OR `employee_id`. Optional: `notes`.

**`create_contact`**: Required: `sender_name`, `sender_email`, `message`. Optional: `sender_phone`, `source_page`.

## Implementation Order

| Step | What |
|------|------|
| 1 | Update `bms-agent/index.ts` — add 10 actions + fix param names |
| 2 | Update `boss-chat/index.ts` — add 9 tools + handlers |
| 3 | Update `whatsapp-messages/index.ts` — add `create_contact` tool |
| 4 | Update `bms-callback/index.ts` — add `new_contact` event |

