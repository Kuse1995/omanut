

# Redesign PDF Quotation/Invoice to Match BMS Layout

## What Changes

The current PDF uses a bold blue header bar with white text. The BMS design (screenshot) uses a clean white layout with:

1. **Company logo** on the left, **company name + subtitle + contact** beside it
2. **"QUOTATION"** title large on the right with document number below
3. Horizontal separator line
4. **"Quote To:"** label with customer name on the left, **Date** on the right, **DRAFT** status badge
5. Clean table: Description, Qty, Unit Price, Amount — no row numbers, light header background (not blue)
6. Totals section below the table
7. White background throughout — no colored header bar

## Implementation

### File: `supabase/functions/generate-document/index.ts`

Rewrite the `case "invoice": case "quotation":` block (lines 189-297):

- **Remove** the blue `drawHeader()` call for quotations/invoices
- **Fetch company logo** from `company_media` or storage (logo category) and embed it using `pdfDoc.embedPng/embedJpg`
- **Layout the header** as:
  - Left: Logo image (56x56), then company name (bold, teal/dark color), subtitle (business_type), contact (email | phone)
  - Right: Large "QUOTATION" or "INVOICE" text, document number below
- **Separator line** below header
- **Quote To / Bill To** section: customer name on the left, date on the right, status badge (DRAFT/SENT)
- **Table redesign**: Remove `#` column, use light gray header background instead of blue, columns: Description, Qty, Unit Price, Amount
- **Totals**: Subtotal, Tax (if applicable), Total — right-aligned below table
- Keep payment info and notes sections as-is (they work fine)

### Colors Update (for quotation/invoice only)
- Header text: dark teal (`rgb(0.05, 0.35, 0.45)`) instead of blue bar
- Table header: light gray background (`rgb(0.94, 0.95, 0.96)`) with dark text
- Status badge: light gray background with dark text for "DRAFT"

### Logo Fetching
- Query `company_media` for category `logo` or similar, or check if company has a logo URL
- Fetch the image bytes via HTTP, embed with `pdfDoc.embedPng()` or `embedJpg()`
- If no logo found, skip the logo area and just show company name

### Files Modified
- `supabase/functions/generate-document/index.ts` — rewrite quotation/invoice layout only (lines ~189-297)

