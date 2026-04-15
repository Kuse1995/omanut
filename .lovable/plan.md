

## Simplify BMS Connection Setup

### Problem
The current BMS Integration card on the Omanut side requires manual entry of the API Secret (which lives on the BMS platform admin) and doesn't show the callback URL that the BMS side needs. Users have to copy-paste between two dashboards with no guidance.

### Changes

#### 1. Auto-generate and display the Callback URL
Show a read-only field with a copy button containing the callback URL that the BMS side needs:
```
https://dzheddvoiauevcayifev.supabase.co/functions/v1/bms-callback
```
This removes guesswork — the admin just copies it into the BMS config.

#### 2. Auto-generate API Secret on first save
Instead of requiring the user to manually enter a matching secret, generate a random secret automatically when creating a new BMS connection. Display it once (like the API Keys section does) so the user can copy it into the BMS platform admin's config for that tenant. On subsequent loads, show it masked with a "reveal" toggle.

#### 3. Pre-fill Bridge URL default
Default the Bridge URL to `https://pkiajhllkihkuchbwrgz.supabase.co/functions/v1/bms-api-bridge` (the known Omanut BMS bridge) so users don't have to type it.

#### 4. Add a "Quick Connect" flow for non-technical users
Add a simplified mode: user clicks "Connect to BMS", system auto-generates the secret and pre-fills the bridge URL. Shows two things to copy to the BMS side:
1. The generated API Secret
2. The Callback URL

### File Changes

| File | Change |
|------|--------|
| `src/components/admin/CompanySettingsPanel.tsx` | Update `BmsIntegrationCard`: add callback URL display with copy button, auto-generate secret on new connections, pre-fill bridge URL default, add reveal/copy for existing secret |

Single file, ~40 lines changed in the BMS card component. No migration needed — no schema changes.

### Result
Setting up a BMS connection becomes: click "Save" → copy the auto-generated secret and callback URL → paste them into the BMS platform admin. No manual secret coordination needed.

