

# Lightweight Query Expansion for Better Semantic Search Hits

## Problem
Short WhatsApp messages ("got any?", "u got water things?", "thx") produce weak embedding vectors with insufficient semantic density. The 0.3 threshold correctly filters bad matches, but thin queries may not reach 0.3 similarity even against correct products.

## Solution
Add a lightweight query normalizer that runs **before** `embedQuery()` — no LLM call, just fast string processing. Two layers:

### Layer 1: WhatsApp Slang Normalizer (zero latency)
Strip emojis, expand common abbreviations, normalize WhatsApp-speak:
- "u" → "you", "r" → "are", "thx" → "thanks", "pls" → "please"
- Remove emoji sequences
- Normalize "how much" → "price"

### Layer 2: Context-Enriched Query (zero latency)
When the query is very short (< 4 words), prepend the company's business category to give the vector more semantic mass:
- Company: Finch (water filtration) + query "got any?" → embed "water filtration products available"
- Company: E Library + query "new ones" → embed "new ebooks digital books available"

This uses the company's existing `services` or `business_type` field from the companies table — no extra DB call since we already have the company object.

### Layer 3: Bump product description quality at index time
Update `embed-catalog` to concatenate more fields (name + description + category + any tags) for richer target vectors.

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/whatsapp-messages/index.ts` | Add `normalizeSearchQuery(query, company)` function before `embedQuery()` calls in both `lookup_product` and `recommend_services` |
| `supabase/functions/embed-catalog/index.ts` | Enrich the text being embedded with category + company context |

## Implementation Detail

```text
function normalizeSearchQuery(query: string, company: any): string {
  // 1. Strip emojis
  // 2. Expand abbreviations (static map, ~20 entries)
  // 3. If query < 4 words, prepend company.services or business_type
  // 4. Return enriched query
}
```

Called at lines 3310 and 3436 before `embedQuery()`.

No database changes. No new edge functions. No extra API calls. Pure string processing.

