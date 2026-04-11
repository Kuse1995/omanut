

## Problem

When updating a company, empty strings `""` are sent for `twilio_number` and `whatsapp_number` instead of `null`. The database has a partial unique index (`unique_twilio_number_idx`) that only excludes `NULL` — so multiple companies with empty string `""` values collide.

## Fix

Convert empty strings to `null` before sending the update/insert to the database. This applies to both the update path (line ~305) and create path (line ~396).

### Changes

**File: `src/components/CompanyForm.tsx`**
- In the update block (~line 305): change `twilio_number: formData.twilio_number` to `twilio_number: formData.twilio_number || null`
- Same for `whatsapp_number` on the next line
- In the create block (~line 396): same treatment for both fields

This is a 2-line fix in each code path (4 lines total). No schema changes needed.

