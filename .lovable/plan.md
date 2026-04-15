

## Enhance Product Identity Manager & Media Library with Smart BMS Integration

### Problems
1. **Product Identity "Add Product" dialog** (screenshot) has no way to suggest product names from BMS inventory — admin has to type manually
2. **Media Library** BMS link dropdown exists but may show "No BMS products found" if the BMS connection isn't active for the company — needs better feedback
3. **AI tagging on upload** only generates category/description/tags — it doesn't try to match uploaded images to known BMS products
4. **No product name suggestion** from AI vision or BMS catalog when creating a Product Identity Profile

### Changes

| Area | File(s) | Change |
|------|---------|--------|
| **BMS product suggestions in Product Identity** | `src/components/admin/ProductIdentityManager.tsx` | Fetch BMS products on mount (same pattern as CompanyMedia). Add a "Suggested Products" dropdown/autocomplete above the Product Name input that lists BMS products. When admin picks one, auto-fill the name. If no BMS connection, allow manual entry as-is. |
| **AI-suggested product name** | `supabase/functions/extract-product-identity/index.ts` | Extend the Gemini vision prompt to also return a `suggested_product_name` field. Pass available BMS product names into the prompt so AI can pick the closest match. Return this in the response so the UI can pre-fill. |
| **Smarter AI tagging on upload** | `supabase/functions/analyze-media/index.ts` | Accept optional `bmsProducts` array in the request body. Add to the Gemini prompt: "If any of these known products match, include `bms_product_id` and `product_name` in your response." This enables auto-linking during upload. |
| **Auto-link on upload** | `src/components/CompanyMedia.tsx` | Pass `bmsProducts` names/IDs to `analyze-media`. If AI returns a `bms_product_id` match, auto-select it in the BMS dropdown and show a toast. |
| **BMS dropdown visibility fix** | `src/components/CompanyMedia.tsx` | If `bmsProducts` is empty, show a small info message "Connect to BMS to link products" instead of a disabled dropdown, so it's clear why no products appear. |

### Flow After Changes

```text
Admin uploads image → AI analyzes → returns category, tags, description
                                   → also checks against BMS product list
                                   → auto-suggests BMS product link if matched

Admin creates Product Identity → sees BMS product dropdown
                               → picks product or types custom name
                               → AI vision extracts fingerprint + validates name
```

### Technical Details
- BMS products fetched via `supabase.functions.invoke('bms-agent', { body: { action: 'list_products', params: { company_id } } })`
- `analyze-media` gets an optional `bmsProductNames` param — a simple `{id, name}[]` array added to the prompt context
- `extract-product-identity` prompt gets `Available BMS products: [list]` appended so it can suggest the best match
- All changes are backward-compatible: if no BMS connection, everything works as before with manual entry

