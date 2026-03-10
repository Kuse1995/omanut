

# Add Editable Descriptions & Tags to Brand Asset Library

## What You Get

Clicking on any asset in the grid opens a dialog showing the image alongside its AI-generated description and tags. You can edit both inline and save. A re-index button lets you re-run AI analysis if needed.

## Changes

### File: `src/components/admin/BrandAssetLibrary.tsx`

1. **Add an "edit" dialog state** — track which asset is selected (`editingAsset`), plus local state for `editDescription` and `editTags` (comma-separated string).

2. **Replace the hover-only delete overlay** with a click handler that opens the edit dialog. Move the delete button into the dialog.

3. **Add a Dialog component** containing:
   - Asset image preview (left/top)
   - Description textarea (editable, pre-filled with AI description)
   - Tags input (editable, comma-separated, pre-filled with AI tags)
   - Category badge (read-only)
   - File name (read-only)
   - Three buttons: **Save**, **Re-index** (re-runs AI vision), **Delete**

4. **Save handler** — updates `company_media` row with new `description` and `tags` array, calls `onAssetsChange()`.

5. **Re-index handler** — calls `index-brand-asset` function, then refreshes.

6. **Show description preview on hover** — add a small tooltip or bottom overlay on each grid tile showing the first ~40 chars of the description, so you can see at a glance what the AI indexed without opening the dialog.

### No backend changes needed
The `company_media` table already has `description` (text) and `tags` (text[]) columns, and existing RLS policies allow updates by company members.

