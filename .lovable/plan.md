

## Goal

Add a manual on/off switch so OpenClaw can only take over conversations when an operator has explicitly enabled it. When the switch is off, OpenClaw's takeover/reply tools refuse to run — even if it tries.

## Where the switch lives

A single per-company toggle: **"Allow OpenClaw to handle conversations"** in the Company Settings panel (`src/components/admin/CompanySettingsPanel.tsx`), with a clear description: *"When off, OpenClaw can read but cannot take over chats or send replies as a human."*

Stored on the `companies` table as a new column `openclaw_takeover_enabled boolean default false` — opt-in by default, so OpenClaw is locked down until you flip it on.

## How the switch is enforced

Inside `supabase/functions/mcp-server/index.ts`, the four "active" OpenClaw tools — `take_over_conversation`, `release_conversation`, `reply_as_human`, and the existing `send_message` / `send_facebook_message` / `send_instagram_message` when called by an OpenClaw key — check `companies.openclaw_takeover_enabled` for the active company before doing anything.

If the switch is off, the tool returns a clean error:
> "OpenClaw takeover is disabled for this company. Enable it in Company Settings → AI Control."

Read-only tools (`list_my_companies`, `get_new_messages`, `list_takeover_conversations`, etc.) keep working — so OpenClaw can observe but not act.

## UI

In `CompanySettingsPanel.tsx`, add a new section **"OpenClaw Agent"** with:
- Switch: **Allow OpenClaw to handle conversations** (bound to `openclaw_takeover_enabled`)
- Helper text explaining what's blocked when off
- A small status line: *"Currently: 2 conversations under OpenClaw control"* (queries `conversations` where `takeover_by = 'openclaw'`) — gives you a quick "is it doing anything right now" view.

Optional kill-switch button: **"Release all OpenClaw conversations"** — flips every active OpenClaw takeover for the company back to AI in one click. Useful for the "haha it went rogue" moment.

## Files to change

- One migration: add `openclaw_takeover_enabled boolean default false` to `companies`.
- `supabase/functions/mcp-server/index.ts`: enforce the flag inside takeover/reply handlers + add the `release_all_openclaw` tool (or just rely on the UI button).
- `src/components/admin/CompanySettingsPanel.tsx`: add the toggle, helper text, live count, and bulk-release button.

## Verification

1. New company → switch is off → OpenClaw `take_over_conversation` returns the disabled error.
2. Flip switch on → `take_over_conversation` works → AI stops replying.
3. Flip switch off while a takeover is active → all OpenClaw-driven conversations auto-release → AI resumes.
4. UI shows the live count of OpenClaw-controlled chats.

