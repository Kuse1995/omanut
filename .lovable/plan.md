

## Diagnosis

OpenClaw is right that references aren't reaching the model. Three concrete gaps:

1. **No MCP tool to trigger generation.** OpenClaw has `list_generated_images` and `update_image_generation_settings`, but no `generate_business_image` tool. So it can only write settings and hope.
2. **`generate-business-image` (the simplest path) ignores references entirely.** It only enhances the text prompt with `business_context`/`style_description`, never passes `inputImageUrls` to Gemini. That's why everything it generates looks generic.
3. **`reference_asset_ids` field exists but is unused.** The DB has it, but neither pipeline reads it. The richer `whatsapp-image-gen` and `test-image-generation` pipelines auto-curate from `company_media` (logos + `category='promotional'` + product matching), but they never consult `reference_asset_ids` — so OpenClaw populating it does nothing.

## Fix plan

### 1. Make `generate-business-image` actually use product references

Rewrite the prompt-building section in `supabase/functions/generate-business-image/index.ts`:
- Accept optional `reference_image_ids: string[]` and `reference_image_urls: string[]` in the request body.
- If the caller doesn't supply references, auto-pull from `company_media` for that company:
  - all media where `id` is in `image_generation_settings.reference_asset_ids` (top priority);
  - then the company's `category='logos'` (1) and `category='products'` (up to 3 most recent);
  - cap at 4 input images (Gemini limit used elsewhere).
- Pass them to `geminiImageGenerate({ prompt, inputImageUrls })` — same call shape `whatsapp-image-gen` and `test-image-generation` already use.
- Add a `HARD GEOMETRY LOCK` preamble (mirroring `whatsapp-image-gen`) when product references are present, so the model treats the first reference as ground-truth.
- Return `{ image_url, image_id, references_used: [...] }` so we can verify in the response.

### 2. Wire `reference_asset_ids` end-to-end

- In `referenceCuratorAgent` inside both `whatsapp-image-gen/index.ts` and `test-image-generation/index.ts`, fetch `image_generation_settings.reference_asset_ids` for the company and prepend those `company_media` URLs to the reference list (priority above auto-curated logos/promo). This makes the manual override OpenClaw was already trying to use actually work.

### 3. Add MCP tools so OpenClaw can drive image generation

In `supabase/functions/mcp-server/index.ts`, add three tools (all gated by the existing `requireOpenClawEnabled` switch — same safety toggle we just built for messaging):

- **`generate_business_image`** — args: `prompt`, optional `reference_media_ids[]`, optional `auto_select_products` (boolean, default true). Calls `generate-business-image` with the active company. Returns image URL + the references it used so OpenClaw can self-evaluate.
- **`set_image_reference_assets`** — args: `media_ids: string[]`. Writes `image_generation_settings.reference_asset_ids` properly (the current `update_image_generation_settings` tool only exposes text fields, which is why OpenClaw was smuggling URLs into `style_description`).
- **`list_product_media`** — args: optional `category` (`products` / `logos` / `promotional`), optional `search`. Returns `{ id, file_name, public_url, description, bms_product_id, category }` so OpenClaw can pick the right canisters/pans/etc. by ID instead of guessing.

### 4. Small UI affordance

In `src/components/ImageGenerationSettings.tsx`, add a "Reference product photos" section:
- Lists `company_media` items in `category in ('products','logos','promotional')` as selectable thumbnails.
- Selection writes to `image_generation_settings.reference_asset_ids` via the existing upsert.
- Helper text: *"These photos will be used as visual anchors for every AI-generated image. Pick 1–4."*

This gives the operator a manual switch matching the new MCP tool, and matches the partial UI already in `ImageGenerationPanel.tsx` (admin) for non-admin company users.

## Files to edit

- `supabase/functions/generate-business-image/index.ts` — accept + auto-pull references, pass to Gemini, return diagnostic.
- `supabase/functions/whatsapp-image-gen/index.ts` — make `referenceCuratorAgent` honor `reference_asset_ids`.
- `supabase/functions/test-image-generation/index.ts` — same fix in its `referenceCuratorAgent`.
- `supabase/functions/mcp-server/index.ts` — add `generate_business_image`, `set_image_reference_assets`, `list_product_media` tools (all gated by `requireOpenClawEnabled`).
- `src/components/ImageGenerationSettings.tsx` — reference picker UI.

No DB schema changes needed — `reference_asset_ids uuid[]` already exists.

## Verification

1. In the Settings UI, pick the bamboo canister product photos as references → save.
2. In OpenClaw: `set_active_company` → ANZ → `list_product_media { category: "products", search: "canister" }` → grab IDs.
3. `generate_business_image { prompt: "promotional poster of bamboo canisters on a kitchen counter", reference_media_ids: [...] }`.
4. Response should include `references_used` with the canister media IDs and the new image should match the actual product (not generic mason jars).
5. Re-run without `reference_media_ids` → auto-selection should still pull canister photos because they were saved as `reference_asset_ids` in step 1.

