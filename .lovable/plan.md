

## BMS Data Sync for AI Training

### What This Does

Adds a "Sync from BMS" button in the AI Training tab. When clicked, it calls the BMS to pull all accessible business data (products, stock levels, categories, pricing), formats it into structured text, and presents it for review before saving to the Knowledge Base.

### Flow

```text
User clicks "Sync from BMS"
  → New edge function calls BMS actions: list_products, low_stock_alerts, get_sales_summary
  → Formats results into structured KB text
  → Returns preview to the UI
  → User reviews, edits if needed, confirms
  → Appended/merged into quick_reference_info (Knowledge Base)
```

### Files to Change

| File | Change |
|------|--------|
| New: `supabase/functions/bms-training-sync/index.ts` | Edge function that calls BMS via `callBMS()` for `list_products`, `low_stock_alerts`, and `get_sales_summary`, then formats results into structured KB text |
| `src/components/admin/AITrainingEditor.tsx` | Add "Sync from BMS" button + preview dialog. Shows formatted data, lets user edit before confirming merge into Knowledge Base |

### Edge Function Logic

1. Load BMS connection for the company
2. Call 3 BMS actions in parallel: `list_products`, `low_stock_alerts`, `get_sales_summary`
3. Format into sections: `## Products & Pricing`, `## Stock Alerts`, `## Sales Overview`
4. Return the formatted text + raw counts for the UI to display

### UI Addition

In `AITrainingEditor.tsx`, next to the existing Knowledge Base card:
- "Sync from BMS" button (only visible when company has a BMS connection)
- Clicking opens a dialog showing the formatted preview
- User can edit the text in the dialog
- "Apply to Knowledge Base" appends/replaces the BMS section in `quick_reference_info`
- Badge shows last sync timestamp

### Technical Details

- BMS connection check: query `bms_connections` for the company on component load to show/hide the button
- The synced data is clearly delimited with `<!-- BMS_SYNC_START -->` / `<!-- BMS_SYNC_END -->` markers so re-syncing replaces only the BMS section
- Edge function reuses `loadBmsConnection` from `_shared/bms-connection.ts` and the same `callBMS` pattern from `bms-agent`

