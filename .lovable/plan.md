## Two things, in order

### Part 1 — Fix the "Connect to Facebook" hang first

The button starts the FB SDK, but `meta-oauth-exchange` has zero logs — meaning the popup never returned a token. Three likely culprits, all fixable from our side or yours:

**A. App ID / Config ID may not be loading**
If `META_APP_ID` is empty in env, `metaConfig.app_id` is `null`, the SDK script never runs, and the button silently does nothing. Fix: show a clear error state when `metaConfig.configured === false`, so we know immediately instead of seeing a spinner forever.

**B. Domain not whitelisted in Meta App Dashboard**
For `FB.login` to even open, your **App Domain** and **Allowed Domains for the JavaScript SDK** must include the URL you're testing on:
- `id-preview--c3a1fe70-ae1b-4186-8abe-4d6d55f532d6.lovable.app` (preview)
- `omanut.lovable.app` (published)

Without this, FB returns `status: 'unknown'` instantly and our `if (!resp.authResponse?.accessToken)` triggers a toast — but if the script itself fails to load, the spinner just hangs.

**C. SDK script load failure / popup blocker**
We don't currently detect script load failure. If `connect.facebook.net` is blocked or slow, `fbReady` never flips true and the button is forever disabled with no feedback.

**Fixes I'll ship:**
1. `meta-public-config` returns clear `configured: false` if either secret is missing — UI shows an admin-only "Meta App not configured" warning card instead of a dead button
2. Add `script.onerror` and a 10s timeout to SDK loader → toast "Couldn't load Facebook SDK. Check ad blocker / domain whitelist"
3. Add a 60s timeout around `FB.login` → toast "Login window timed out. Please try again"
4. Add a small inline note under the button listing the exact domains that must be whitelisted in the Meta App, with a copy-to-clipboard button
5. Console-log the full FB response so we can see `status: 'not_authorized'` vs `unknown` vs `connected` when debugging

### Part 2 — Add WhatsApp Cloud API alongside Twilio (zero disruption)

The provider-toggle approach. Existing companies keep Twilio untouched. New connections opt into Meta Cloud. Switching is per-company and reversible.

```text
companies.whatsapp_provider:
  'twilio'      → keep using existing Twilio path (default for all current rows)
  'meta_cloud'  → use new Graph API path
```

#### Database

```sql
-- Per-company WhatsApp Cloud credentials (only populated for opt-in companies)
create table company_whatsapp_cloud (
  company_id uuid primary key references companies(id) on delete cascade,
  waba_id text not null,
  phone_number_id text not null unique,
  display_phone_number text not null,
  business_name text,
  access_token text not null,            -- system user token (long-lived)
  webhook_subscribed_at timestamptz,
  health_status text default 'pending',  -- pending|live|suspended
  connected_via text default 'embedded_signup',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Provider switch — defaults to 'twilio' so nothing breaks
alter table companies add column whatsapp_provider text default 'twilio'
  check (whatsapp_provider in ('twilio', 'meta_cloud'));
```

RLS: same ownership/manager pattern as `meta_credentials`. Token never leaves edge functions.

#### New edge functions (additive — zero impact on Twilio code)

| Function | Purpose |
|---|---|
| `whatsapp-cloud-signup` | Embedded Signup token exchange → fetches WABA + phone_number_id, stores in `company_whatsapp_cloud` |
| `whatsapp-cloud-subscribe` | POSTs to `/{phone_number_id}/subscribed_apps` so Meta forwards inbound to our webhook |
| `send-whatsapp-cloud` | Sends via `https://graph.facebook.com/v21.0/{phone_number_id}/messages` |

#### Webhook routing (additive)

`meta-webhook` already handles FB + IG. We add a `messages` field handler that:
1. Recognizes WhatsApp Cloud payloads (`entry[].changes[].field === 'messages'`)
2. Resolves `phone_number_id` → company via `company_whatsapp_cloud`
3. Normalizes the payload into the same shape the existing `whatsapp-messages` core processor expects
4. Hands off to the **same** AI/BMS/boss-notification pipeline

Twilio inbound (`/whatsapp-messages`) stays exactly as it is. No code in that function changes.

#### Outbound dispatcher (the only "shared" change)

Create `_shared/whatsappSender.ts`:

```ts
export async function sendWhatsApp(supabase, company, to, body, mediaUrls?) {
  if (company.whatsapp_provider === 'meta_cloud') {
    return sendViaMetaCloud(supabase, company.id, to, body, mediaUrls);
  }
  return sendViaTwilio(company, to, body, mediaUrls);  // existing logic, untouched
}
```

Then in each of the ~7 places that call Twilio directly, swap the inline fetch for `sendWhatsApp(...)`. The Twilio path is identical bytes — just relocated. No behavior change for Twilio companies.

#### UI

New "WhatsApp Provider" card in the existing Meta Integrations panel:
- Status: shows current provider + connected number + health
- "Connect WhatsApp directly via Meta" button → opens Embedded Signup popup
- After successful signup, shows a toggle: **Use this for WhatsApp** (flips `whatsapp_provider` to `meta_cloud`)
- Big yellow note: "Switching will route all future WhatsApp traffic through Meta. Your Twilio number will stop receiving messages until you switch back."
- "Switch back to Twilio" button always available

#### Migration safety net

- `whatsapp_provider` defaults to `'twilio'` → every existing row is unaffected
- New companies created today still get `'twilio'` until they explicitly opt in
- If `company_whatsapp_cloud` row is missing for a `meta_cloud` company, we **fall back to Twilio** with a console warning instead of failing — belt and suspenders
- A "Test message" button on the WhatsApp panel sends a real ping through whichever provider is active so the boss can verify before going live

#### Required Meta App setup (one-time, on your side)

- Add **WhatsApp** product to your existing Meta App in App Dashboard
- Submit `whatsapp_business_management` + `whatsapp_business_messaging` for App Review (3–7 days, only blocks public rollout — internal testing works without it)
- Set the WhatsApp webhook to: `https://dzheddvoiauevcayifev.supabase.co/functions/v1/meta-webhook`
- Subscribe to the `messages` field

#### What stays untouched

- `whatsapp-messages` (Twilio inbound webhook) — not modified
- `send-whatsapp-message` (Twilio outbound) — not modified, just wrapped by the dispatcher
- All AI flows, BMS hooks, boss notifications, conversation history, frustration detection
- Twilio voice (`twilio-voice`, `whatsapp-voice`) — out of scope, stays as is
- Every existing company's `whatsapp_number` value

#### Out of scope for this round

- Voice over Meta (not GA)
- Migrating existing Twilio companies (they stay until they choose to switch)
- Removing Twilio code (we keep it indefinitely as the fallback)

## Order of work

1. **Fix FB Connect hang** (Part 1) — small, isolated, ships first so you can actually use what we already built
2. **Migration + edge functions for WhatsApp Cloud** (Part 2 backend)
3. **WhatsApp panel UI + provider toggle** (Part 2 frontend)
4. **Wire the dispatcher into the ~7 Twilio call sites** (Part 2 wiring, last because it touches many files)

Each step is independently shippable. We can stop after step 1 if you want to test the Facebook connect first.
