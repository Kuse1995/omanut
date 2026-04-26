# One-Click Meta Connect (Facebook Login for Business)

## The problem today

Onboarding to Meta currently requires the customer to:
1. Open Facebook Business Manager
2. Find their Page ID (15-digit number)
3. Generate a long-lived Page Access Token (developer-mode steps)
4. If they want Instagram, find the IG Business Account ID
5. Paste all three into the Meta Integrations panel

This is acceptable for a single agency client, but for SaaS it is the #1 onboarding drop-off. Customers do not know what a "Page Access Token" is, tokens leak in screenshots, and tokens can expire silently.

## The fix: Facebook Login + auto-discovery

We add a single **"Connect Facebook & Instagram"** button. The user logs in with their Facebook account, picks which Page(s) to connect, and we do the rest behind the scenes:

- Exchange the short-lived user token for a long-lived user token
- List the Pages they manage and let them pick (multi-select)
- For each chosen Page, fetch the **never-expiring Page Access Token** automatically
- Auto-detect the linked **Instagram Business Account** (no copy-pasting IDs)
- Subscribe the Page + IG to our webhook automatically (existing `subscribe-meta-page` logic)
- Save everything to `meta_credentials` with no manual fields

The existing manual "paste token" form stays as an **Advanced** fallback (for power users / edge cases / agencies installing on behalf of a client).

## User flow

```text
Meta Integrations panel
┌─────────────────────────────────────────────────┐
│  [ Connect with Facebook ]   ← big primary CTA  │
│                                                  │
│  Already connected:                              │
│   • Page: ANZ Kitchenware  [FB] [IG] [⚙][🗑]    │
│   • Page: Demo Lodge       [FB]      [⚙][🗑]    │
│                                                  │
│  ▸ Advanced: paste credentials manually         │
└─────────────────────────────────────────────────┘

Click "Connect with Facebook"
  → Facebook popup (login + consent)
  → "Pick the Pages to connect" dialog (checkboxes)
  → Auto-discovers IG Business ID for each
  → Auto-subscribes webhooks
  → Done. Cards appear with green "Live" badges.
```

Tokens, Page IDs, and IG IDs are never shown to the user during the happy path.

## What we need from the user (one-time, platform-level)

To use Facebook Login we need a **Meta App** configured with the right products and permissions. This is a one-time setup the platform owner does in developers.facebook.com — customers never see this.

We will require these secrets (added via Lovable Cloud secrets):
- `META_APP_ID` (public, also used in frontend SDK init)
- `META_APP_SECRET` (server-only, used for token exchange)
- `META_CONFIG_ID` (Facebook Login for Business config — recommended modern flow)

Permissions the app must request (already standard for this use case):
`pages_show_list`, `pages_manage_metadata`, `pages_read_engagement`, `pages_messaging`, `pages_manage_posts`, `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`, `instagram_content_publish`, `business_management`.

These are the same permissions we use today via the manually-pasted token, so no new App Review is needed if the app is already approved. If not yet approved, the Connect button works for whitelisted test users immediately and goes live after Meta App Review (a separate, one-time submission).

## Technical implementation

### Frontend (`src/components/admin/MetaIntegrationsPanel.tsx`)

1. Load the Facebook JS SDK on mount, initialised with `META_APP_ID` exposed via a small `meta-public-config` edge function (so the App ID isn't hardcoded).
2. New primary button → `FB.login({ config_id: META_CONFIG_ID, response_type: 'code' })`.
3. On success, send the returned `code` (or short-lived token) to a new edge function `meta-oauth-exchange`.
4. Backend returns `{ pages: [{ id, name, picture, ig_user_id }] }`.
5. Show a "Pick Pages to connect" dialog with checkboxes + Page picture/name.
6. On confirm, call `meta-oauth-connect-pages` with the chosen page IDs.
7. Invalidate `['meta-credentials']` query and show success.
8. Existing manual form is moved into a collapsed `<Accordion>` labelled "Advanced: paste token manually".

### New edge functions

**`meta-oauth-exchange`** (verify_jwt = true)
- Input: `{ code }` or `{ short_lived_token }` from FB SDK.
- Exchanges code → short-lived user token → long-lived user token via `oauth/access_token` using `META_APP_SECRET`.
- Calls `GET /me/accounts?fields=id,name,picture,access_token,instagram_business_account` with the long-lived user token.
- Returns sanitized `{ pages: [{ id, name, picture_url, ig_user_id, _server_token_ref }] }`. The actual Page tokens are cached server-side in a short-lived `meta_oauth_sessions` row keyed by a UUID, so they never touch the browser.

**`meta-oauth-connect-pages`** (verify_jwt = true)
- Input: `{ session_id, page_ids: string[], company_id }`.
- For each chosen page: read the cached Page token + ig_user_id from the session, upsert into `meta_credentials` (one row per page, scoped to the user's company via existing RLS).
- Invokes existing `subscribe-meta-page` to wire webhooks.
- Deletes the temp session row.
- Returns `{ connected: [{ page_id, page_name, ig_linked: bool, webhook_subscribed: bool }] }`.

**`meta-public-config`** (verify_jwt = false)
- Returns `{ app_id, config_id }` — public values, safe to expose.

### Database

New tiny table `meta_oauth_sessions` to bridge the two function calls without leaking Page tokens to the browser:

```text
meta_oauth_sessions
  id             uuid pk
  user_id        uuid  (= auth.uid())
  company_id     uuid
  pages          jsonb  -- [{id, name, picture_url, access_token, ig_user_id}]
  created_at     timestamptz default now()
  expires_at     timestamptz default now() + interval '15 min'
RLS: owner-only select/delete. Service role full access.
Cron: delete where expires_at < now() (re-uses existing cleanup pattern).
```

No changes needed to `meta_credentials` schema — we still write the same `page_id`, `access_token`, `ig_user_id`, `platform`. The "Additional Instructions" prompt field stays editable from the card's edit button.

### Token health & expiry UX

Page Access Tokens obtained via this flow are long-lived (no expiry) **as long as** the underlying user token stays valid (60 days, auto-refreshed on each FB login). To make this visible:
- Add a nightly cron `meta-token-health` that pings `/me?access_token=...` for each credential and writes `last_verified_at` + `health_status` to `meta_credentials`.
- The card shows `🟢 Healthy`, `🟡 Expires soon`, or `🔴 Reconnect needed`.
- A `🔴` card replaces its edit button with a one-click "Reconnect" that re-runs the same FB Login flow and overwrites the row in place.

(Two new nullable columns on `meta_credentials`: `last_verified_at timestamptz`, `health_status text default 'unknown'`. Backwards compatible.)

## What stays the same

- `meta_credentials` table shape, RLS, and all downstream consumers (`meta-webhook`, `publish-meta-post`, `publish-facebook-post`, `send-meta-dm`, `send-facebook-message-reply`, `send-facebook-comment-reply`, `meta-ads-*`) — they keep reading `page_id` + `access_token` exactly as today.
- The existing "paste manually" form — kept under Advanced for agencies and edge cases.
- `subscribe-meta-page` — re-used by the new flow.

## Out of scope (call out for later)

- WhatsApp Business onboarding via Embedded Signup (different flow, different App product). We can add `whatsapp-oauth-*` later using the same pattern.
- Meta App Review submission — that's a one-time platform task done outside this codebase.

## Deliverables

1. Migration: `meta_oauth_sessions` table + 2 nullable columns on `meta_credentials`.
2. Edge functions: `meta-public-config`, `meta-oauth-exchange`, `meta-oauth-connect-pages`, `meta-token-health` (cron).
3. Updated `MetaIntegrationsPanel.tsx` with Facebook Login button, page picker dialog, health badges, reconnect action, and Advanced fallback.
4. Add secrets prompt for `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID` (you provide these once from your Meta App dashboard; I'll walk you through exactly where to find them after you approve this plan).
5. Memory file `mem://features/meta-oauth-onboarding.md` documenting the flow.
