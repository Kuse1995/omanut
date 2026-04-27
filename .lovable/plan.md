## Goal

Stop exposing Twilio/WhatsApp setup controls to clients. The admin owns the Twilio account, so clients should only **see** their assigned number and be able to **copy/share** it — never reconfigure it. Add a memory rule so future work doesn't regress this.

## Changes

### 1. Read-only WhatsApp card on `/setup`
File: `src/pages/Setup.tsx`

- Remove the `onClick={() => navigate("/settings")}` from the WhatsApp `IntegrationCard`.
- When `status.whatsapp === "connected"`: pass a `rightSlot` with a small "Copy number" button (uses `navigator.clipboard`, toast on success). No chevron, no navigation.
- When not connected: replace the chevron CTA with a muted helper line + a "Request a number" button that opens `https://wa.me/260977000000?text=Hi%20Omanut%2C%20please%20provision%20a%20WhatsApp%20number%20for%20{companyName}`.
- Update description copy so it never implies the client configures Twilio:
  - Connected: `"Your customers reach you on this number. Managed by Omanut."`
  - Not connected: `"We'll provision and manage a WhatsApp number for your business. Tap below to request one."`

### 2. New "Your WhatsApp number" banner on Dashboard
File: `src/components/dashboard/WhatsAppNumberBanner.tsx` (new) + wire into `src/pages/Dashboard.tsx` directly under the header (above `SetupChecklist`).

- Reads `useSetupStatus()` for `whatsappLabel` / number.
- Compact card showing:
  - Label: "Share this with your customers"
  - The number in large mono text (e.g. `+260 97 700 0000`, formatted via `src/lib/format.ts`)
  - Two buttons: **Copy** and **Share via WhatsApp** (`https://wa.me/?text=Chat%20with%20{companyName}%20on%20WhatsApp%3A%20{number}`)
- Hidden when no number is provisioned yet (renders a dimmed "WhatsApp number pending — we're setting it up" instead).

### 3. Settings page: hide WhatsApp/Twilio tab from clients
File: `src/pages/Settings.tsx`

- The "Numbers" tab currently lets clients edit `whatsapp_number`/`twilio_number` via `PhoneInput`. Gate that tab behind the admin role using `useCompanyRole()` — clients see a read-only display of their assigned number with the same Copy / Share affordances; only admins see the editable inputs.
- Keep Business / Calendar / Media / Knowledge tabs unchanged for clients.

### 4. System Status card on Dashboard
File: `src/pages/Dashboard.tsx`

- Replace "Not configured" wording with "Pending setup" when `whatsapp_number` is empty (clients shouldn't think they did something wrong).

### 5. Lock the rule in memory
New file: `mem://constraints/whatsapp-setup-admin-only.md`

```
---
name: WhatsApp setup is admin-only
description: Twilio/WhatsApp number provisioning is owned by the Omanut admin team. Client UI must be read-only.
type: constraint
---
Clients use Omanut's Twilio account. They MUST NOT see editable Twilio fields, account SIDs, auth tokens, or webhook URLs.
- /setup WhatsApp card: status + copy/share only, no navigation to edit forms.
- Dashboard: surface the assigned number prominently for sharing with customers.
- Settings "Numbers" tab: gated behind admin role via useCompanyRole().
Why: support burden, billing security, and Twilio credentials are ours.
How to apply: when adding any WhatsApp/Twilio UI, check role first; otherwise render read-only.
```

Update `mem://index.md` Memories list to add this entry.

## Files touched

- `src/pages/Setup.tsx` — read-only WhatsApp card + request-number CTA
- `src/components/dashboard/WhatsAppNumberBanner.tsx` — new
- `src/pages/Dashboard.tsx` — mount banner, soften System Status copy
- `src/pages/Settings.tsx` — admin-gated Numbers tab
- `src/lib/format.ts` — add `formatPhoneDisplay()` helper if not present
- `mem://constraints/whatsapp-setup-admin-only.md` + `mem://index.md`

## Out of scope

- No DB migrations.
- No edge function changes.
- Admin-side Twilio config (under `/admin/...`) stays exactly as-is.
