

# Finch Investments Limited -- Not Responding on WhatsApp or Facebook

## Diagnosis

### WhatsApp (Twilio +260766195857)
**Status: No incoming messages reaching the system.**
- The `whatsapp-messages` edge function shows **zero logs** for the Finch number.
- The "single tick" issue you mentioned earlier confirms Twilio is not delivering messages to the webhook.
- This is a **Twilio-side configuration issue** -- the number may be in sandbox mode with an expired session, or the webhook URL is not saved correctly.

**Action required (no code change):**
1. In Twilio Console, go to the WhatsApp sender for +260766195857
2. Verify the webhook URL is `https://dzheddvoiauevcayifev.supabase.co/functions/v1/whatsapp-messages` with method POST
3. If it's a sandbox number, re-join by sending the sandbox keyword from the phone
4. Check **Twilio Monitor > Errors** for 11200/11205 errors (HTTP delivery failures)

### Facebook Comments (Page ID: 931406013380258)
**Status: Facebook is not sending webhook events for Finch's page.**
- The `meta-webhook` logs show activity only for E Library (page `776455652221283`), zero for Finch.
- Finch has a valid `meta_credentials` record with page_id `931406013380258` and an access token.
- The issue is that Facebook's App is **not subscribed to receive events** for Finch's page.

**Root cause:** When a new Facebook Page is connected, the app must be programmatically subscribed to that page via the Graph API. Without this subscription, Facebook will never send webhook events for that page, regardless of the meta_credentials record existing in the database.

## Fix: Auto-Subscribe Pages to Webhooks

### What needs to change
When a Facebook Page's credentials are saved (in the Meta Integrations panel), the system should call the Meta Graph API to subscribe the app to the page:

```
POST /{page-id}/subscribed_apps?subscribed_fields=feed,messages&access_token={page_access_token}
```

This is a one-time call per page that tells Facebook: "Send webhook events for this page to my app."

### Implementation

1. **Create a new edge function `subscribe-meta-page`** that:
   - Accepts `{ credential_id }` (the meta_credentials record ID)
   - Loads the page_id and access_token from meta_credentials
   - Calls `POST https://graph.facebook.com/v18.0/{page_id}/subscribed_apps` with fields `feed,messages`
   - If the credential has an `ig_user_id`, also subscribes for Instagram fields
   - Returns success/failure status

2. **Update the Meta Integrations panel** (`MetaIntegrationsPanel.tsx`) to call `subscribe-meta-page` after saving credentials, so new pages are automatically subscribed.

3. **Immediate fix for Finch:** Call the subscription API for page `931406013380258` using the stored access token to start receiving events right away.

### No database changes required
The `meta_credentials` table already has all needed columns.

