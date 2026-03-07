

# Fix: Empty Twilio/WhatsApp Numbers Causing Unique Constraint Violations

## Problem
The `unique_twilio_number_idx` partial index excludes `NULL` but not empty strings (`""`). "Demo AI" already has `twilio_number = ''`, so creating Finch with an empty twilio_number field causes a duplicate key violation.

## Solution

Two changes:

1. **Fix existing data** -- Set empty-string `twilio_number` and `whatsapp_number` values to `NULL` across all companies.

2. **Fix the `create-company` edge function** -- Convert empty strings to `NULL` before inserting, so empty optional fields don't trigger unique constraint violations. Apply this to both `twilio_number` and `whatsapp_number`.

### Edge function change (`create-company/index.ts`)
Before the insert, normalize empty strings:
```typescript
const normalizedTwilio = twilio_number?.trim() || null;
const normalizedWhatsapp = whatsapp_number?.trim() || null;
```
Then use these normalized values in the insert.

### Data fix (migration)
```sql
UPDATE public.companies SET twilio_number = NULL WHERE twilio_number = '';
UPDATE public.companies SET whatsapp_number = NULL WHERE whatsapp_number = '';
```

This ensures future creates won't conflict, and existing bad data is cleaned up.

