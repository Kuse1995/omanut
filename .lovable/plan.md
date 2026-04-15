

## Make BMS Linking Visible + AI Vision Auto-Match in Media Library

### Problem
The "Link to BMS Product" dropdown exists but is buried at step 5 in the upload form — below the fold. Existing media items have no way to edit or link to BMS. The AI analyzer returns match suggestions but there's no edit dialog to act on them for already-uploaded items.

### Changes

| Area | File | Change |
|------|------|--------|
| **Edit dialog for existing media** | `CompanyMedia.tsx` | Add a Dialog that opens when clicking any media card. Shows: image preview, BMS product dropdown, description (editable), tags (editable), category selector, and a "Re-analyze with AI" button. Save updates via `supabase.from('company_media').update(...)`. |
| **AI re-analyze button** | `CompanyMedia.tsx` | In the edit dialog, a "🔍 AI Analyze" button calls `analyze-media` with `bmsProducts` context. Auto-fills description, tags, category, and auto-selects BMS product if matched. |
| **Visual hover indicator** | `CompanyMedia.tsx` | Add a semi-transparent overlay with pencil/edit icon on hover for each media card, signaling they're clickable. |
| **Upload form: move BMS dropdown higher** | `CompanyMedia.tsx` | Move the BMS product dropdown from step 5 to step 2 (right after file selection), so it's always visible without scrolling. |
| **AI vision auto-link on upload** | `CompanyMedia.tsx` | After `analyze-media` returns a `bms_product_id` match, auto-select it AND show a prominent toast with the matched product name. Already partially implemented — just needs the toast to be more visible. |
| **Edge function: vision match improvement** | `analyze-media/index.ts` | Already updated. No further changes needed — it accepts `bmsProducts` and returns match data. |

### Edit Dialog Flow

```text
Click media card → Dialog opens
  → Image preview at top
  → BMS Product dropdown (pre-selected if already linked)
  → Description textarea (editable)
  → Tags input (editable)
  → Category selector
  → [Re-analyze with AI] button → calls analyze-media → updates all fields
  → [Save] button → updates company_media row
  → [Cancel] button
```

### Technical Details
- Edit dialog reuses existing `bmsProducts` state (already fetched on mount)
- Save uses `supabase.from('company_media').update({ description, tags, category, bms_product_id }).eq('id', mediaId)`
- Re-analyze calls `supabase.functions.invoke('analyze-media', { body: { imageDataUrl, fileName, fileType, businessType, bmsProducts } })` — requires fetching the image URL from signed URL
- Media cards get `cursor-pointer` and hover overlay with `Pencil` icon from lucide-react

