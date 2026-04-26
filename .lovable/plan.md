## Plan

Phased migration to direct Meta WhatsApp Cloud API alongside the existing Twilio integration. **Status: shipped.**

### What's live

1. **DB** — `companies.whatsapp_provider` (default `twilio`), `company_whatsapp_cloud` table for opt-in creds.
2. **Outbound** — `send-whatsapp-message` checks the provider flag; if `meta_cloud`, delegates to `send-whatsapp-cloud` (Meta Graph `/{phone_number_id}/messages`). Twilio path is the default.
3. **Inbound** — `meta-webhook` handles `object === 'whatsapp_business_account'`, resolves the company by `phone_number_id`, normalizes text/media/interactive payloads, and bridges them as JSON into `whatsapp-messages` (which now accepts a `source: 'meta_cloud_webhook'` mode alongside the existing promise-fulfillment mode).
4. **Admin UI** — `MetaIntegrationsPanel` exposes a manual WhatsApp Cloud setup card; saving creds flips `whatsapp_provider` to `meta_cloud`, deleting reverts it.
5. **Facebook Connect hang** — SDK timeout shortened, diagnostic toasts added.

### Known follow-ups (not blocking)

- Internal Twilio fan-outs inside `whatsapp-messages` (boss handoff, multi-image dispatch) still call Twilio's API directly. They work fine for Twilio clients but won't fire correctly for `meta_cloud` clients. Refactor those helpers to use `send-whatsapp-message` (which already routes per-provider) before the first `meta_cloud` client is onboarded in production.
- Embedded Signup flow (Facebook Login → auto-create WABA) can replace the manual creds form once Meta App review is approved.
