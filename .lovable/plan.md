

## Current State

1. **Same boss number for multiple companies**: Already possible at the database level (no unique constraint). However, the `boss-chat` function resolves company by phone with `ilike` + `limit(1)`, so when a boss texts in, it picks one company arbitrarily. This needs a selection mechanism.

2. **Multiple boss numbers per company**: Not supported. `boss_phone` is a single `text` column on `companies`. All notification functions (`send-boss-notification`, `send-boss-reservation-request`, `daily-briefing`, etc.) read `company.boss_phone` as a single value.

---

## Plan

### Step 1: Create a `company_boss_phones` table

New junction table to support multiple boss numbers per company:

```
company_boss_phones
- id (uuid, PK)
- company_id (uuid, FK → companies)
- phone (text, NOT NULL)
- label (text) — e.g. "Owner", "Manager", "Night shift"
- is_primary (boolean, default false)
- notify_reservations (boolean, default true)
- notify_payments (boolean, default true)
- notify_alerts (boolean, default true)
- created_at (timestamptz)
```

- Unique constraint on `(company_id, phone)` to prevent duplicates within a company.
- No cross-company uniqueness — same phone can exist in multiple companies.
- RLS: company members can read; owners/managers can write.
- Migration seeds existing `boss_phone` values into the new table as `is_primary = true`.

### Step 2: Update boss-chat company resolution

When an inbound message arrives without a `companyId`:
- Query `company_boss_phones` for all companies matching the sender's phone.
- If exactly 1 match → use that company (current behavior).
- If multiple matches → present a numbered menu: "You manage multiple companies. Reply with the number: 1. Company A, 2. Company B" and track the selection in session state (e.g. `boss_conversations` or in-memory for the request).

### Step 3: Update all notification functions to send to multiple numbers

Affected functions (~8):
- `send-boss-notification` — loop over all boss phones for the company
- `send-boss-reservation-request` — send to all phones with `notify_reservations = true`
- `daily-briefing` — send to all phones
- `boss-media-watchdog` — send to all phones
- `sla-escalation` — send to all phones with `notify_alerts = true`
- `csat-followup` — send to primary phone
- `handle-boss-response` — already receives `From`, no change needed
- `whatsapp-image-gen` — uses `bossPhone` from request, no change needed

Each function will query `company_boss_phones` instead of `companies.boss_phone`. A shared helper in `_shared/` will provide `getBossPhones(supabase, companyId, filter?)`.

### Step 4: Update the CompanyForm UI

Replace the single "Boss Phone" text input with a multi-entry UI:
- List of phone entries with label, phone number, and notification toggles.
- Add/remove buttons.
- Mark one as primary.
- On save, sync to `company_boss_phones` table.

### Step 5: Keep backward compatibility

- Keep `companies.boss_phone` column as a computed/synced field (primary phone) for any code not yet migrated, updated via a trigger on `company_boss_phones`.
- Gradually deprecate direct reads of `companies.boss_phone`.

---

## Summary of changes

| Area | Files | Change |
|------|-------|--------|
| Database | Migration | New `company_boss_phones` table + seed from existing data + sync trigger |
| Shared helper | `_shared/boss-phones.ts` | `getBossPhones()` utility |
| Edge functions | ~6 notification functions | Query new table, loop sends |
| Boss chat | `boss-chat/index.ts` | Multi-company selection menu |
| Frontend | `CompanyForm.tsx` | Multi-phone management UI |

