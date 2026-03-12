

# Semantic Product Search for All Companies (Finch + E Library + All Future)

## Problem

The "wrong product" issue affects **every company**, not just E Library. Three search tools all use naive word-in-string matching:

1. **`lookup_product`** (line 3422-3427): Splits query into words, checks `text.includes(word)`. If nothing matches, **returns ALL products** as fallback — the AI then picks randomly.
2. **`recommend_services`** (line 3323-3331): Same keyword approach, minimum 3-char words match unrelated products.
3. **External catalog** (line 3381-3387): Same pattern — word split + fallback to all products.

For Finch (water filters with technical specs), a customer asking "I need something for my family's drinking water" won't match a product called "LifeStraw Community" unless those exact words appear. The fallback then dumps all products and the AI guesses.

## Solution — Gemini Embedding 2 Semantic Search (All Companies)

### Database Changes

| Change | SQL |
|--------|-----|
| Enable pgvector | `CREATE EXTENSION IF NOT EXISTS vector` |
| Add embedding column to `payment_products` | `ALTER TABLE payment_products ADD COLUMN embedding vector(768)` |
| Add embedding index | `CREATE INDEX idx_products_embedding ON payment_products USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)` |
| Add similarity search function | `CREATE FUNCTION match_products(query_embedding vector(768), match_company_id uuid, match_threshold float, match_count int)` |

### New Files

| File | Purpose |
|------|---------|
| `supabase/functions/_shared/embedding-client.ts` | Shared module: `embedText(text)` calls Gemini Embedding 2 API with `output_dimensionality: 768`, returns vector |
| `supabase/functions/embed-catalog/index.ts` | Edge function: embeds all products for a company (or single product on create/update). Called from admin UI or on-demand |

### Modified Files

| File | Change |
|------|--------|
| `supabase/functions/whatsapp-messages/index.ts` | Replace word-matching in `lookup_product` and `recommend_services` with vector similarity search. **Remove the "return all products" fallback.** Add similarity threshold (0.3) so only relevant results return. When no results pass threshold, return "No matching products found" instead of dumping everything. |

### How It Works

```text
INDEXING (one-time per product, re-run on update):
  "LifeStraw Community - High-volume water purifier for schools"
    → Gemini Embedding 2 API (768 dims)
    → stored in payment_products.embedding

QUERY TIME:
  Customer: "I need clean water for my school"
    → Gemini Embedding 2 API → query vector
    → SELECT * FROM match_products(query_vec, company_id, 0.3, 5)
    → Returns "LifeStraw Community" (semantic match, no keyword overlap needed)
```

### Key Details

- Uses existing `GEMINI_API_KEY` secret — no new keys needed
- 768 dimensions (reduced from 3072 via `output_dimensionality`) — fast, sufficient for product catalogs
- Works for **all companies** automatically — Finch, E Library, any future company
- External catalog companies: embedding happens at query time only (embed the query, then do text matching as before — full vector search on external DBs is a future enhancement)
- Fallback: if embedding API fails, gracefully falls back to current keyword matching (no breakage)
- Admin UI: add "Index Products" button to trigger `embed-catalog` for a company

### Scope

This replaces the broken matching logic **system-wide**. Every company with local products benefits immediately after running `embed-catalog`. Finch's water filtration products, E Library's ebooks, and any future company's catalog will all get semantic search.

