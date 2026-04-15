

## Link Media Library to BMS Inventory

### Idea
Add a `bms_product_id` column to `company_media` so each uploaded image can be linked to a specific BMS product. When the AI needs to generate or send a product image, it matches by product ID instead of fuzzy text/embedding search — giving exact results.

### How It Works

1. **Database**: Add nullable `bms_product_id` (text) column to `company_media`
2. **UI**: In the media upload/edit form, add a "Link to BMS Product" dropdown that fetches products from the BMS via the `bms-agent` function (`list_products` intent) and lets the admin pick which product this image represents
3. **Image Generation**: When the AI needs a product image (in `whatsapp-image-gen`, `generate-business-image`), it first checks for media with a matching `bms_product_id` before falling back to embedding search — guaranteeing the right product photo is used
4. **Auto-match on sync**: Optionally, during BMS training sync, attempt to auto-link unlinked media to products by comparing the AI-generated description/tags against product names

### Changes

| Area | File(s) | Change |
|------|---------|--------|
| **Migration** | New migration | `ALTER TABLE company_media ADD COLUMN bms_product_id text` |
| **UI** | `src/components/CompanyMedia.tsx` | Add a "Link to BMS Product" select dropdown in the upload form. Fetch products via `supabase.functions.invoke('bms-agent', { body: { action: 'list_products', params: { company_id } } })`. Save selected product ID to `bms_product_id`. Show linked product name on existing media cards. |
| **Image Gen** | `supabase/functions/whatsapp-image-gen/index.ts` | Before embedding search, query `company_media` where `bms_product_id` matches the product from the conversation context. Use that image as the reference if found. |
| **Sync (optional)** | `supabase/functions/bms-training-sync/index.ts` | After fetching products, attempt to match unlinked media descriptions to product names and auto-set `bms_product_id` |

### Result
- Admins upload a product photo → pick "Coca-Cola 500ml" from BMS dropdown → image is permanently linked
- Customer asks about Coca-Cola → AI pulls the exact linked photo instead of guessing from tags
- No more cross-product contamination in image generation

