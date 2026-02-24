

# Plan: Demo Mode with Hardcoded Demo Number +13345083612

## Overview

When someone texts the Twilio number `+13345083612`, the system enters **demo mode** instead of normal company routing. The boss number for the company that owns this number controls the demo via WhatsApp commands (`DEMO [company]`, `ERASE`, `ACT AS [persona]`). Customers get an instant AI experience powered by live web research.

## How It Works

```text
Customer texts +13345083612
        |
  whatsapp-messages detects DEMO NUMBER
        |
  Routes to demo-session edge function
        |
  demo-session checks:
    - Is sender the boss? --> Handle commands (DEMO, ERASE, ACT AS, STATUS)
    - Is there an active demo_session? --> AI responds as that company
    - No session? --> "Welcome! Ask the business owner to set up a demo."
```

## Database Changes

### New table: `demo_sessions`

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid (PK) | Auto-generated |
| company_id | uuid | The company that owns the demo number |
| phone | text | Customer phone interacting with demo |
| demo_company_name | text | Company being demonstrated (e.g. "Hilton Lusaka") |
| researched_data | jsonb | Full research results from AI |
| custom_persona | text | Boss override (e.g. "friendly hotel concierge") |
| status | text | active / expired |
| created_at | timestamptz | When session started |
| expires_at | timestamptz | Auto-expire after 24 hours |

RLS: Service role only (edge functions handle all access). Platform admins can SELECT.

## New Edge Function: `demo-session`

Handles the entire demo lifecycle:

**Boss Commands** (detected when sender matches the company's `boss_phone`):
- `DEMO Hilton Lusaka` -- Calls `research-company` function, stores result in `demo_sessions`, confirms to boss
- `ERASE` / `RESET` / `CLEAR` -- Deletes all active demo sessions, confirms to boss
- `ACT AS friendly hotel concierge` -- Updates `custom_persona` on all active sessions
- `STATUS` -- Returns current demo company name and active session count

**Customer Messages** (any non-boss sender):
- Looks up active `demo_session` for the company
- If found: builds an AI prompt from `researched_data` + `custom_persona`, generates response via Lovable AI
- If not found: sends a friendly "Demo not active yet" message
- Auto-cleans expired sessions (older than 24 hours) on each request

## Changes to `whatsapp-messages/index.ts`

Add a check right after company lookup (around line 3280). If the company's `whatsapp_number` matches `+13345083612` (the hardcoded demo number), route the entire request to the `demo-session` function and return its response as TwiML.

```text
// After company lookup succeeds:
const DEMO_NUMBER = '+13345083612';
if (company.whatsapp_number?.replace('whatsapp:', '') === DEMO_NUMBER) {
  // Route to demo-session function
  // Return TwiML with demo response
}
```

This intercept happens **before** boss detection, onboarding, and normal message processing -- keeping demo traffic completely isolated.

## Technical Details

### AI Prompt for Demo Responses

The demo AI prompt is constructed dynamically from researched data:

```text
You are demonstrating Omanut AI by acting as [demo_company_name]'s
AI receptionist.

Business type: [from research]
Services: [from research]  
Hours: [from research]
Style: [custom_persona or researched voice_style]
Key info: [quick_reference_info]

Stay in character. Be impressive and natural. Handle bookings,
pricing, FAQs. If asked about Omanut AI itself, briefly explain
the platform then return to character.
```

### Auto-Expiry

- Sessions expire after 24 hours (set at creation)
- Expired sessions cleaned up on each incoming request (no cron needed)
- Boss can manually erase anytime

### Files to Create/Modify

| File | Action |
|------|--------|
| Database migration | Create `demo_sessions` table with RLS |
| `supabase/functions/demo-session/index.ts` | New -- demo lifecycle handler |
| `supabase/functions/whatsapp-messages/index.ts` | Modify -- add demo number routing intercept |

### No UI changes needed

The demo is entirely WhatsApp-driven. The boss controls everything via text commands to the same number.
