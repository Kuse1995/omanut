

## Enhance Auto-Content Creator with BMS Intelligence

### Current State
- `auto-content-creator` already loads `quick_reference_info` (which now contains BMS-synced products, stock alerts, sales data)
- But it dumps it as a raw blob: `Quick reference: ${company.quick_reference_info}` — the AI doesn't know to use specific products or stock levels for content ideas

### What to Change

**Single file: `supabase/functions/auto-content-creator/index.ts`**

#### 1. Parse BMS sections from quick_reference_info
Extract the `<!-- BMS_SYNC_START -->` / `<!-- BMS_SYNC_END -->` block and parse it into structured sections (products, stock alerts, sales) so the prompt can reference them specifically.

#### 2. Upgrade the caption prompt with product-aware instructions
Replace the generic "Quick reference" line with structured context:

```text
AVAILABLE PRODUCTS:
- Product A: K150 (In Stock)
- Product B: K200 (Low Stock - only 3 left!)

SALES TRENDS:
- Top seller: Product A (45 sold this week)

Create a post that:
- Features a SPECIFIC product from the list above
- If any items are low stock, create urgency ("Almost sold out!")
- Reference actual prices
- Tie to current sales trends when possible
```

#### 3. Add content variety by rotating strategies
To avoid repetitive posts, add a random strategy selector:
- **Product spotlight** — feature one specific product with price
- **Low stock urgency** — "Almost gone!" for low-stock items  
- **Bestseller highlight** — promote top-selling products
- **General brand** — fallback when no BMS data exists

This is ~25 lines changed in the caption prompt section (lines 91-108). No new files, no migrations.

### Result
Instead of generic posts like "Visit us today! 🎉", the AI generates inventory-aware content like "Our Classic Leather Bag (K350) is almost sold out — only 2 left! Grab yours before they're gone 👜🔥"

