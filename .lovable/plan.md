

# Phase 1: BMS Deep Integration — High-Impact Actions + Callbacks

## Scope

From your spec, Phase 1 covers:

**New BMS Actions (8 actions to add):**
- `get_product_variants` (#4) — customer asks about colors/sizes
- `create_order` (#8) — customer places an order via WhatsApp
- `get_order_status` (#9) — both customer and boss check order status
- `update_order_status` (#10) — boss marks order as shipped/delivered
- `cancel_order` (#11) — customer or boss cancels an order
- `get_customer_history` (#27) — purchase history lookup
- `get_company_statistics` (#38) — impact stats
- Enhanced `sales_report` (#30) — already exists, needs `date_from/date_to/group_by` params

**Already exist (no changes needed):**
- `check_stock` (#1), `list_products` (#2), `get_product_details` (#3) — already in bms-agent

**Callback System (5 callbacks):**
- C1: Low stock alert → boss WhatsApp
- C3: New order → boss WhatsApp
- C4: Payment confirmed → boss + customer WhatsApp
- C5: Order shipped → customer WhatsApp
- C10: Daily sales summary → boss WhatsApp

## Files to Change

### 1. `supabase/functions/bms-agent/index.ts`
Add 7 new switch cases: `get_product_variants`, `create_order`, `get_order_status`, `update_order_status`, `cancel_order`, `get_customer_history`, `get_company_statistics`. Enhance `sales_report` to pass `date_from`, `date_to`, `group_by`. Update available_actions list.

### 2. `supabase/functions/whatsapp-messages/index.ts`
- **Tool definitions** (~line 1810 area): Add `get_product_variants`, `create_order`, `get_order_status`, `cancel_order`, `get_customer_history`, `get_company_statistics` to `allToolDefinitions`
- **Complexity classifier** (~line 22): Add `order|variant|color|size|track|cancel|history` to complex triggers
- **Tool handlers** (~line 3000 area): Add `else if` blocks for each new tool that calls `bms-agent`
- **Mandatory checkout tools** (~line 1819): Add `create_order`, `get_order_status` to auto-merged tools

### 3. `supabase/functions/boss-chat/index.ts`
- **Tool definitions** (~line 744): Add `get_order_status`, `update_order_status`, `cancel_order`, `get_customer_history`, `get_company_statistics` tools
- **Tool handlers** (~line 870 switch): Add cases that call `bms-agent` for each new tool

### 4. `supabase/functions/bms-callback/index.ts` (NEW)
New edge function that receives webhook POSTs from the BMS when events occur (C1, C3, C4, C5, C10). Authenticates via `BMS_API_SECRET` header. For each event type:
- Looks up the company's boss phone from `companies` table
- Sends WhatsApp via `send-whatsapp-message` for boss notifications
- Sends customer WhatsApp for customer-facing events (C4, C5)

### 5. `supabase/config.toml`
Add `[functions.bms-callback]` with `verify_jwt = false` (webhook endpoint).

## Callback Webhook Design

The BMS will POST to `https://<project>.supabase.co/functions/v1/bms-callback` with:
```json
{
  "event": "low_stock",
  "company_id": "...",
  "data": { "product_name": "...", "current_stock": 5, "reorder_level": 10 }
}
```

Auth: `Authorization: Bearer <BMS_API_SECRET>` — same secret used for outbound calls, now bidirectional.

The callback handler maps each event to a WhatsApp message template and sends it to the appropriate recipient (boss phone from companies table, or customer phone from the event data).

## Implementation Order

| Step | What |
|------|------|
| 1 | Update `bms-agent/index.ts` with all 7 new actions |
| 2 | Update `whatsapp-messages/index.ts` with tools + handlers for customer-facing actions |
| 3 | Update `boss-chat/index.ts` with tools + handlers for boss-facing actions |
| 4 | Create `bms-callback/index.ts` for inbound webhook events |

## What This Enables

- Customer on WhatsApp: "I want to order 2 LifeStraw Go bottles" → AI creates order, sends confirmation
- Customer: "Where is my order ORD-2026-0042?" → AI fetches status from BMS
- Customer: "What colors does the LifeStraw Go come in?" → AI shows variants
- Boss: "Mark order ORD-2026-0042 as shipped" → BMS updates, customer gets notified
- BMS detects low stock → boss gets WhatsApp alert automatically
- BMS receives new online order → boss gets WhatsApp notification

