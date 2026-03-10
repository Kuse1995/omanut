

# Fix: BMS Stock Data Showing Blank in Boss Chat

## Root Cause

The BMS returns fields named `current_stock` and `unit_price`, but boss-chat's formatting code references `quantity` and `selling_price` — which don't exist on the response objects. This causes the stock and price to render as `undefined`.

**BMS actual response:**
```json
{ "name": "Lifestraw Family", "current_stock": 90, "unit_price": 730, "reorder_level": 20 }
```

**Boss-chat expects:**
```typescript
p.quantity    // undefined — should be p.current_stock
p.selling_price  // undefined — should be p.unit_price
```

## Fix

**`supabase/functions/boss-chat/index.ts`** — Update the `check_stock` formatter (lines 1688-1694) to use correct field names with fallbacks for both naming conventions:

```typescript
// Line 1689: Use current_stock with quantity fallback
const qty = p.current_stock ?? p.quantity ?? 0;
const price = p.unit_price ?? p.selling_price ?? 0;
const status = qty <= 0 ? '🔴' : qty <= (p.reorder_level || 5) ? '🟡' : '🟢';
return `${status} ${p.name}: ${qty} in stock @ ${company.currency_prefix}${price}`;
```

Same fix for the single-object branch (lines 1692-1694).

This is a 6-line change. Stock data will immediately display correctly in Boss Chat.

