

# Live Catalog Integration: E Library → Christian Ebook Shelf

## Problem
The E Library AI currently pulls product data from the local `payment_products` table and `quick_reference_info`. This data is static, can get stale, and doesn't reflect real-time catalog changes on the e-book website. You want the AI to exclusively source product information from the live e-book website database.

## Approach
Store the external catalog connection (the e-book project's database URL + anon key) on the E Library company record. When the AI handles a conversation for E Library, the `lookup_product`, `list_products`, and `check_stock` tools query the **external** `ebooks` table directly instead of the local `payment_products` table.

```text
Customer WhatsApp → whatsapp-messages → lookup_product tool
                                            │
                        ┌───────────────────┴───────────────────┐
                        │ external_catalog_url set?             │
                        │                                       │
                    YES ▼                                   NO  ▼
            Query ebooks table on                   Query payment_products
            Christian Ebook Shelf                   on local Omanut DB
            (urevgkspvzyazikrfmvp)
```

## Database Changes

**Add columns to `companies` table:**

| Column | Type | Purpose |
|--------|------|---------|
| `external_catalog_url` | text | Supabase URL of the e-book project |
| `external_catalog_key` | text | Anon key for read-only access |
| `external_catalog_table` | text | Table name to query (default: `ebooks`) |

These are nullable — only set for companies with an external catalog. No secrets needed since the anon key is a publishable key.

## Edge Function Changes (`whatsapp-messages/index.ts`)

1. **Fetch external catalog config** when loading company data (already loads `companies.*`).

2. **Modify `lookup_product` handler** (~line 3296): If `company.external_catalog_url` is set, create a temporary Supabase client pointing at the external project and query its `ebooks` table instead of `payment_products`. Map `ebooks` fields (title→name, price, description, author, category, cover_url) to the same response shape.

3. **Modify BMS `list_products` / `check_stock` handlers** (~line 3363): Same pattern — if external catalog is configured, query external `ebooks` table. For `check_stock`, digital products are always "in stock".

4. **Inject catalog into system prompt** (~line 1431): When `external_catalog_url` is set, fetch the full e-book catalog and inject it as the knowledge base instead of `quick_reference_info` product sections, so the AI always has current titles/prices.

## What This Enables
- AI answers product questions using live data from the website
- Price changes on the website are immediately reflected in WhatsApp conversations
- New books added to the website are instantly available to the AI
- No manual sync or duplicate data entry needed

## Files to Create/Modify

| File | Action |
|------|--------|
| Migration SQL | Add 3 columns to `companies` |
| `supabase/functions/whatsapp-messages/index.ts` | External catalog logic in tool handlers + system prompt |

After implementation, you just set the E Library company's `external_catalog_url` and `external_catalog_key` to the e-book project values, and the AI will exclusively use that data.

