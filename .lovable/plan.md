

# Streaming Acknowledgement for Slow BMS Tool Calls

## Problem

When BMS tool calls (check_stock, sales_report, etc.) take longer than ~8 seconds, the customer sees nothing — no typing indicator, no acknowledgement. This creates a poor experience where it looks like the bot is unresponsive.

## Solution

Add a **race-based timeout wrapper** around every BMS tool call. If the BMS doesn't respond within 8 seconds, immediately send a "streaming acknowledgement" message to the customer via Twilio (e.g., "Let me check that for you, one moment..."), then continue waiting for the actual BMS result.

### Architecture

```text
Customer asks "Do you have X in stock?"
       │
       ▼
AI calls check_stock tool
       │
       ├── BMS responds < 8s → normal flow (no ack)
       │
       └── BMS takes > 8s →
              ├── Send ack via Twilio: "Checking our warehouse now, one moment… 🔍"
              └── Continue waiting for BMS result → send final answer
```

### Implementation

**1. Create `bmsCallWithAck` helper function** (in `whatsapp-messages/index.ts`)

A wrapper that:
- Starts the BMS fetch
- Starts an 8-second timer
- If timer fires first: sends a Twilio acknowledgement message to the customer, sets a flag so the final response knows an ack was already sent
- Returns the BMS result regardless

**2. Replace all direct BMS `fetch()` calls** in the first-round tool execution block

Currently there are ~10+ BMS tool handlers (`check_stock`, `record_sale`, `get_product_variants`, `create_order`, `get_order_status`, `cancel_order`, `get_customer_history`, `get_company_statistics`, `create_quotation`, `create_invoice`, `get_low_stock_items`, etc.) that each call `fetch(bms-agent)` directly. Wrap each in `bmsCallWithAck`.

**3. Same pattern for multi-round tool loop** (rounds 2-5)

The multi-round loop at line ~3396 also has BMS tool handlers. Apply the same wrapper there.

**4. Apply to `boss-chat/index.ts`**

The boss-chat function has its own BMS tool handlers. Apply the same streaming ack pattern there, sending the ack to the boss's WhatsApp number instead.

**5. Context-aware ack messages**

Different tools get different acknowledgement messages:
- `check_stock` / `get_product_variants` → "Checking our inventory now, one moment... 🔍"
- `sales_report` / `get_company_statistics` → "Pulling up your reports, one moment... 📊"
- `create_order` / `record_sale` → "Processing your order, please hold... 🛒"
- `create_quotation` / `create_invoice` → "Generating your document, just a moment... 📄"
- Default → "Working on that for you, one moment... ⏳"

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/whatsapp-messages/index.ts` | Add `bmsCallWithAck` helper, wrap all BMS fetch calls in both first-round and multi-round tool handlers |
| `supabase/functions/boss-chat/index.ts` | Add same `bmsCallWithAck` helper, wrap all BMS tool handlers in the tool execution loop |

## No database changes needed

