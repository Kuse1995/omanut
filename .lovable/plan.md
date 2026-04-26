## Plan

We’ll keep the current Twilio setup untouched and add the direct WhatsApp integration beside it, so existing clients keep working while new/direct Meta WhatsApp accounts can be onboarded gradually.

## 1. Fix the Facebook connect loading issue first

From the screenshot, the button is stuck on “Connecting…” and the console shows two useful clues:

- `Failed to fetch ... /auth/v1/user` / `net::ERR_CONNECTION_CLOSED`
- Radix dialog warnings: `DialogContent requires a DialogTitle`

I’ll harden this flow so it cannot stay stuck indefinitely:

- Add a shorter connection watchdog around the backend exchange call, not only around the Facebook popup.
- Always reset `fbConnecting` when auth/session lookup or the exchange call fails.
- Surface a clear error message in the UI when the browser cannot reach authentication/backend services.
- Add missing accessible dialog title/description handling where needed, including the page picker dialog and shared command/media dialogs if they are contributing warnings.
- Improve logging around the exact phase: SDK load, Facebook popup, auth check, token exchange, page picker.

## 2. Keep Twilio as the default WhatsApp provider

No breaking migration:

```text
Existing clients        -> Twilio WhatsApp continues as-is
New direct integrations -> Meta WhatsApp Cloud API
Company-by-company     -> Switchable later
Voice features          -> Twilio remains available
```

The new `companies.whatsapp_provider` field already defaults to `twilio`, so current clients are protected.

## 3. Add Meta WhatsApp Cloud connection path

I’ll add the direct WhatsApp integration as a parallel option in the Meta Integrations admin panel:

- Add a “Connect WhatsApp directly” card below Facebook/Instagram.
- Store direct WhatsApp credentials in the new `company_whatsapp_cloud` table.
- Support manual setup first if Embedded Signup requires more Meta app review/config, with fields for:
  - WABA ID
  - Phone Number ID
  - Business phone display number
  - Access token
- Add status indicators so the admin can see whether a company is using Twilio or direct WhatsApp.

## 4. Add backend functions for direct WhatsApp sending

I’ll add a new backend function for Meta WhatsApp Cloud outbound messages:

- `send-whatsapp-cloud`
  - validates the logged-in user/company access
  - loads that company’s WhatsApp Cloud credentials
  - sends text/media through Meta Graph API
  - returns clear Meta errors instead of generic failures

Twilio functions like `send-whatsapp-message`, `whatsapp-messages`, `twilio-status-webhook`, and voice functions remain in place.

## 5. Add provider routing without disrupting Twilio

I’ll introduce a shared provider decision point for outbound WhatsApp:

```text
send WhatsApp request
        |
        v
check company.whatsapp_provider
        |
        +-- twilio      -> existing Twilio sender
        |
        +-- meta_cloud  -> new Meta WhatsApp Cloud sender
```

Initially, Twilio remains the fallback if direct WhatsApp is not configured or the provider is still `twilio`.

## 6. Prepare inbound WhatsApp Cloud webhook routing

I’ll extend the existing `meta-webhook` to recognize WhatsApp Cloud webhook payloads and normalize them into the same conversation pipeline where possible.

This will be added carefully so it does not touch the existing Twilio inbound webhook behavior.

## Technical details

Files likely to change:

- `src/components/admin/MetaIntegrationsPanel.tsx`
  - fix stuck loading states
  - improve error UI
  - add WhatsApp Cloud section
- `src/components/ui/dialog.tsx` and/or dialog consumers
  - fix accessibility warnings where dialogs lack title/description
- `supabase/functions/send-whatsapp-cloud/index.ts`
  - new Meta WhatsApp Cloud outbound sender
- `supabase/functions/meta-webhook/index.ts`
  - add WhatsApp payload handling without changing Facebook/Instagram logic
- existing WhatsApp sender helpers/functions as needed
  - add provider routing while preserving Twilio default
- database migration if the existing WhatsApp Cloud table needs small additions such as `display_phone_number`, `status`, or token metadata

## Order of implementation

1. Fix Facebook connect stuck loading and dialog warnings.
2. Add the WhatsApp Cloud admin UI and credential verification.
3. Add direct WhatsApp outbound sender.
4. Add safe provider routing while leaving Twilio as default.
5. Add inbound webhook support for WhatsApp Cloud payloads.

This keeps the rollout slow and safe: first fix the current connection bug, then add direct WhatsApp alongside Twilio instead of replacing it.