

## Fix secondary boss phone save + add roles

### Why the second number didn't save

In `CompanyForm.tsx` (line 359), the boss-phones insert error is **swallowed silently**:

```ts
if (phoneError) console.error('Error saving boss phones:', phoneError);
```

No toast, no thrown error → the form shows "Company updated successfully" even when the phones insert fails. Most likely cause of the actual failure: a unique constraint on `(company_id, phone)` exists, and the delete-then-insert sequence sometimes hits a race or the second row's phone got typed identically/empty/duplicated by the legacy `companies.boss_phone` reload. Two real bugs:

1. **Silent error** — user sees "Success" but nothing saved.
2. **No client-side validation** — duplicate phones, empty phones, or missing `+` prefix are submitted as-is and rejected by the DB.

### Roles for boss phones

Today each entry has three notification toggles (`notify_reservations`, `notify_payments`, `notify_alerts`). You're asking for proper **roles** like "Social Media Manager", "Owner", "Accountant", etc. — where the role determines what notifications they get and what they can do via WhatsApp boss-chat.

### Plan

#### 1. Surface the real save error
- In `CompanyForm.tsx`, throw on `phoneError` instead of `console.error` so the toast shows the actual DB message.
- Validate before insert: trim phones, require a leading `+`, deduplicate by phone, ensure exactly one `is_primary`.
- Show inline red text per row when validation fails (no submit until fixed).

#### 2. Add a `role` column to `company_boss_phones`
DB migration:
- Add `role text not null default 'owner'` to `company_boss_phones`.
- Add a CHECK-via-trigger (not a CHECK constraint, per memory) restricting role to a known set: `owner`, `manager`, `social_media_manager`, `accountant`, `operations`, `support_lead`, `custom`.
- Add `role_label text` (free-text) for when role = `custom`.
- Backfill: existing rows → `role = 'owner'` if `is_primary`, else `'manager'`.

#### 3. Role → notification preset mapping
Each role implies sensible defaults the user can still override per-toggle:

| Role | reservations | payments | alerts | social media | content approval |
|---|---|---|---|---|---|
| Owner | ✓ | ✓ | ✓ | ✓ | ✓ |
| Manager | ✓ | ✓ | ✓ | – | ✓ |
| Social Media Manager | – | – | – | ✓ | ✓ |
| Accountant | – | ✓ | – | – | – |
| Operations | ✓ | – | ✓ | – | – |
| Support Lead | – | – | ✓ | – | – |

Two new toggle columns are needed to support the social-media role:
- `notify_social_media boolean default false` (post drafts, comment alerts, scheduling needs)
- `notify_content_approval boolean default false` (AI-drafted posts awaiting approval)

Selecting a role in the UI **prefills** the toggles; user can still tweak.

#### 4. UI updates in `CompanyForm.tsx` boss-phones section
- New "Role" dropdown per entry (owner/manager/social media manager/accountant/operations/support lead/custom).
- When role = `custom`, show a label text field.
- Add the two new toggles ("Social media", "Content approval") to the existing toggle row.
- Show a small role badge in the entry header.

#### 5. Route notifications by role/toggle
- `_shared/boss-phones.ts` — extend `BossPhoneFilter` with `notify_social_media` and `notify_content_approval`. Return the new fields in `BossPhone`.
- `send-boss-notification/index.ts` — add notification types `social_media_alert` and `content_approval_request`; route them via `getBossPhones(..., { notify_social_media: true })` / `{ notify_content_approval: true }`.
- `publish-meta-post`, `schedule-meta-post`, `auto-content-creator`, `boss-media-watchdog`: when something needs social-media-manager attention, call `send-boss-notification` with the new types so only the relevant phones get pinged.
- Existing flows (`send-boss-reservation-request`, `sla-escalation`, payment alerts) keep their current filters — backward compatible.

#### 6. Boss-chat awareness of role
- `boss-chat/index.ts` already resolves the company by phone. Extend the lookup to also return the caller's `role` and inject one line into the system prompt: `You are speaking with the {role_label or role} for {company_name}. Tailor responses to their domain (e.g. social media manager → focus on content + scheduling; accountant → finance + payments).`
- No tool changes — purely prompt-level scoping.

#### 7. Memory
- `mem://features/boss-phone-roles.md` — document role enum, notification mapping, and prompt-injection rule.

### Files

- `src/components/CompanyForm.tsx` — surface insert errors, validate, role dropdown + new toggles.
- DB migration — add `role`, `role_label`, `notify_social_media`, `notify_content_approval`; validation trigger; backfill.
- `supabase/functions/_shared/boss-phones.ts` — extend `BossPhone` and `BossPhoneFilter`.
- `supabase/functions/send-boss-notification/index.ts` — handle new notification types.
- `supabase/functions/boss-chat/index.ts` — inject role into system prompt.
- `supabase/functions/publish-meta-post`, `schedule-meta-post`, `auto-content-creator`, `boss-media-watchdog` — route social-media-related pings to the right phones.
- New memory file.

### Validation

1. Add a second boss phone with role = "Social Media Manager", save → row appears in DB with the right role + toggles. Remove its phone, save → toast shows the actual DB error (no false success).
2. AI generates a post needing approval → only the social-media-manager phone gets the WhatsApp ping; owner doesn't.
3. New reservation comes in → only `notify_reservations = true` phones get pinged (owner + manager + operations).
4. Social-media-manager messages the boss line → AI greeting acknowledges their role.

No new tools, no UI redesign, additive schema only.

