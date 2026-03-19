

# Align BMS Integration to Spec

## Summary

The current `bms-agent` sends `{ action: "check_stock", ...params }` to the BMS bridge, but the spec requires `{ intent: "check_stock", tenant_id: "<uuid>", ...fields }`. Additionally, several actions from the spec are missing. This plan updates `bms-agent`, `bms-callback`, and `boss-chat` tool definitions to match the spec.

## Current vs Spec Gaps

| Issue | Current | Spec |
|---|---|---|
| Payload key | `action` | `intent` |
| Tenant ID | Only injected for `multi_tenant` type | Always required |
| Missing actions | N/A | `credit_sale`, `get_sales_summary`, `get_sales_details`, `low_stock_alerts`, `bulk_add_inventory`, `check_customer`, `who_owes`, `create_contact`, `send_receipt`, `send_invoice`, `send_quotation`, `send_payslip`, `my_attendance`, `my_tasks`, `my_pay`, `my_schedule`, `team_attendance`, `pending_orders`, `daily_report` |
| Action name mismatches | `sales_report` | `get_sales_summary` / `get_sales_details` |
| Action name mismatches | `get_low_stock_items` | `low_stock_alerts` |
| Callback events | Missing `large_sale` handling already exists, but field names differ slightly | Align field names |

## Changes

### 1. `supabase/functions/_shared/bms-connection.ts`
- No structural changes needed. The `tenant_id` is already stored and retrieved.

### 2. `supabase/functions/bms-agent/index.ts`
- Change `callBMS` to send `intent` instead of `action` in the payload
- Always inject `tenant_id` (not just for multi-tenant)
- Update `AVAILABLE_ACTIONS` to include all spec actions
- Add action name mapping for backward compatibility: `sales_report` → `get_sales_summary`, `get_low_stock_items` → `low_stock_alerts`
- Flatten params into the payload body (spec expects flat fields, not nested `params`)

### 3. `supabase/functions/boss-chat/index.ts`
- Add new BMS tool definitions: `credit_sale`, `who_owes`, `send_receipt`, `send_invoice`, `send_quotation`, `send_payslip`, `daily_report`, `bulk_add_inventory`, `check_customer`, `pending_orders`
- Add HR tools: `my_attendance`, `my_tasks`, `my_pay`, `my_schedule`, `team_attendance`
- Add new case handlers in the BMS switch block
- Update system prompt to reference new tools
- Map legacy names: `sales_report` → `get_sales_summary` (keep `sales_report` as an alias for backward compat)

### 4. `supabase/functions/whatsapp-messages/index.ts`
- Add new BMS tool names to the `BMS_ACK_MESSAGES` map
- Add new tools to the mandatory checkout tools list where appropriate
- Add tool definitions for customer-facing BMS actions (`check_customer`, `who_owes`, `send_receipt`, `pending_orders`)

### 5. `supabase/functions/bms-callback/index.ts`
- Align callback event field names to spec (minor adjustments to `buildEventMessages`)
- No structural changes needed — already handles all spec events

## Technical Detail

Key change in `bms-agent/callBMS`:
```typescript
// Before:
const payload = { action, ...params };

// After:
const payload = { intent: action, tenant_id: connection.tenant_id, ...params };
```

Action alias map in `bms-agent`:
```typescript
const ACTION_ALIASES: Record<string, string> = {
  sales_report: "get_sales_summary",
  get_low_stock_items: "low_stock_alerts",
  get_company_statistics: "get_sales_summary",
};
const resolvedIntent = ACTION_ALIASES[action] || action;
```

## Files Modified
- `supabase/functions/bms-agent/index.ts` — intent field, tenant_id, aliases, expanded action list
- `supabase/functions/boss-chat/index.ts` — new tool definitions, case handlers, system prompt
- `supabase/functions/whatsapp-messages/index.ts` — new tool definitions, ack messages
- `supabase/functions/bms-callback/index.ts` — minor field name alignment

