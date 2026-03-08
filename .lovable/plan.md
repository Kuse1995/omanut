

# Add BMS Tools (check_stock, record_sale) to Boss-Chat

## Problem
The boss-chat function lacks BMS tools. When the boss asks about stock levels, the AI says it has no inventory access — even though the BMS bridge is fully configured and working in the customer-facing function.

## Changes

### File: `supabase/functions/boss-chat/index.ts`

**1. Add two tools to the `managementTools` array** (after `get_hot_leads`, before the closing `]` at line 863):

- `check_stock` — identical definition to whatsapp-messages (takes `product_name`)
- `record_sale` — identical definition to whatsapp-messages (takes `product_name`, `quantity`, `payment_method`, `customer_name`, `customer_phone`)

**2. Add two cases to the tool execution `switch` block** (before the `default:` case at line 1347):

- `case 'check_stock'`: POST to `https://hnyzymyfirumjclqheit.supabase.co/functions/v1/bms-api-bridge` with `{ action: 'check_stock', product_name }` and `BMS_API_SECRET` auth header. Return stock data as result message.
- `case 'record_sale'`: POST to same endpoint with `{ action: 'record_sale', product_name, quantity, payment_method, customer_name, customer_phone }`. Return sale confirmation as result message.

**3. Update the system prompt** (around line 564, in the "YOUR CAPABILITIES" section):

Add a new capability section:
```
10. **Inventory & Sales (BMS)**: You have REAL-TIME access to the business inventory system.
   - Use check_stock to look up current stock levels and pricing for any product
   - Use record_sale to log completed sales with customer details
   - When the boss asks about stock, inventory, or product availability - use check_stock immediately
```

### No other files changed
The BMS API bridge and `BMS_API_SECRET` are already configured and working.

