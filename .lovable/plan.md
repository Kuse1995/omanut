## Goal

Make OpenClaw the primary responder for ANZ General Dealers and North Park School (re-applied as a safety reset), and make `primary` the default for every newly created company.

## Changes

### 1. Update existing companies (data — via insert tool)

```sql
UPDATE companies
SET openclaw_mode = 'primary',
    openclaw_owns = '{"bms":true,"content":true,"handoff":true,"meta_dm":true,"comments":true,"whatsapp":true}'::jsonb
WHERE id IN (
  '74ec87e8-a075-45b7-af75-e7503d683818', -- ANZ General Dealers
  '900e4a14-6fa4-495a-a63c-54ce54a27fdf'  -- North Park School – Solwezi Campus
);
```

ANZ flips from `assist` → `primary`. North Park is already `primary` with all skills owned; this re-applies as a no-op safety reset.

### 2. Change column defaults so future companies start in `primary` (schema — via migration tool)

```sql
ALTER TABLE companies
  ALTER COLUMN openclaw_mode SET DEFAULT 'primary'::openclaw_mode_t,
  ALTER COLUMN openclaw_owns SET DEFAULT
    '{"bms":true,"content":true,"handoff":true,"meta_dm":true,"comments":true,"whatsapp":true}'::jsonb;
```

Any new row inserted via the admin UI / `create-company` edge function (which doesn't pass these fields) will land in primary mode with all six skills owned.

### 3. Caveat (no code change)

A new company still needs `openclaw_webhook_url` filled in before OpenClaw can actually receive events. Until that URL is set, `openclaw-dispatch` will log `dispatch_status = 'no_webhook'` and the internal AI is gated out by primary mode — meaning nothing will reply. I'll flag this in the closing message so onboarding remembers to paste the webhook URL.

## Technical Details

- Migration only — no edge function or frontend changes.
- The `openclaw-dispatch` function and `gateSkill()` helper already honor `openclaw_mode = 'primary'` + per-skill ownership; no behavioral code change needed.
- Existing 5 companies already in `primary` are unaffected.
