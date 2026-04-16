

## Fix: BMS `check_stock` Returns Wrong Data — AI Says "Not in Stock" for Available Products

### Root Cause (Confirmed via Live API Testing)

The BMS bridge (`pkiajhllkihkuchbwrgz.supabase.co/functions/v1/bms-api-bridge`) **completely ignores the `product_name` parameter** on `check_stock`. It always returns the same 10 items regardless of what product you ask about. Blue pans, blue dinner set — none appear in those 10 items.

The fallback code added previously (line 4198-4231) calls `list_products` when the product isn't found. `list_products` DOES return blue pans with `current_stock: 4`. However, the test messages (09:05-09:07 UTC) were sent **before** the fallback was deployed, so the AI only saw the 10 random items from check_stock, didn't find blue pans, and concluded they're out of stock.

### Current Fallback Gaps

Even with the fallback deployed, there are issues:

1. **`list_products` only returns ~15 items** — if inventory grows, products could still be missed
2. **No `current_stock` emphasis** — the fallback returns raw data but doesn't explicitly tell the AI "this product IS in stock with X units"
3. **Condition `stockData.length > 0`** — if check_stock returns an empty array, fallback doesn't trigger
4. **Single-word product matches are too loose** — "pan" could match "Bamboo canister S (Moosa)" via partial match bugs

### Fix (in `whatsapp-messages/index.ts`)

**1. Always fallback to `list_products` when check_stock doesn't find the target product**

Remove the `stockData.length > 0` guard — always try list_products if the product isn't in check_stock results, even if check_stock returned empty.

**2. Increase list_products limit and pass search param**

Instead of fetching the full unfiltered catalog, pass `product_name` as a search hint to `list_products` so the BMS bridge can filter (if it supports it), and increase the local filter to handle larger inventories.

**3. Add explicit stock status to the fallback response**

When the fallback finds matched products, format the result to clearly state stock availability:
```typescript
bmsResult = { 
  success: true, 
  data: matched,
  message: `Found ${matched.length} matching product(s): ${matched.map(p => `${p.name} - ${p.current_stock} in stock at K${p.unit_price}`).join(', ')}`
};
```

**4. Fix the empty-array edge case**

Change condition from `if (!found && stockData.length > 0)` to `if (!found)` so the fallback always fires when the product wasn't found.

### Files Changed
- `supabase/functions/whatsapp-messages/index.ts` — fix check_stock fallback logic

### Expected Results
- "Do you have blue pans?" → AI checks stock → fallback finds them in catalog → "Yes, Blue pans 24cm (4 in stock, K450) and Blue pans 28cm (4 in stock, K550)"
- "Is the blue dinner set available?" → Same flow → "Yes, 5 in stock at K1,200"

