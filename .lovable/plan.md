## Problem

Facebook Login for Business is rejecting the popup with:
> Invalid parameter: response_type must be a valid enum. response_type=token is not supported in this flow.

The frontend currently asks the SDK for an access token (default behavior). FB Login for Business only supports the **authorization-code** flow — Meta hands back a short-lived `code`, and our backend must exchange it for the user token using `META_APP_SECRET`.

The fix has two parts: ask the SDK for a `code`, and teach `meta-oauth-exchange` to redeem that code.

---

## Changes

### 1. Frontend — `src/components/admin/MetaIntegrationsPanel.tsx`

In the `connectWithFacebook` flow:

- Add `response_type: 'code'` to `loginOpts` (alongside `config_id`, `scope`, `return_scopes`).
- Update the FB.login callback to read `resp.authResponse.code` instead of `resp.authResponse.accessToken`.
- Send the code to the backend as `{ code, company_id }` (no `redirect_uri` — the JS SDK uses an internal one and the backend will mirror that).
- Update the TypeScript type for `authResponse` to include the optional `code` field.
- Keep the existing 30s watchdog, IIFE async wrapper, and error toasts unchanged.

### 2. Backend — `supabase/functions/meta-oauth-exchange/index.ts`

The function already supports a `code` branch but currently requires `redirect_uri`. For the JS-SDK Business Login flow, Meta does NOT use a real redirect URI — the code was minted via `postMessage` inside a popup. The exchange call must therefore be made with an **empty** `redirect_uri` parameter (this is what the SDK does internally).

Update the `code` branch:

- Make `redirect_uri` optional in the request body. If omitted, default to an empty string when calling `${FB_GRAPH}/oauth/access_token`.
- Keep the existing long-lived token upgrade and Pages listing — no changes there.
- Keep the `short_lived_token` branch as a fallback for any legacy callers.

### 3. No DB / no config changes

The Meta App config (config_id, app_id, secret) is already stored. No migration needed.

---

## Technical detail

```ts
// Frontend: ask Meta for a code, not a token
const loginOpts: Record<string, unknown> = {
  scope: '...',
  return_scopes: true,
  response_type: 'code',          // <-- the fix
};
if (metaConfig?.config_id) loginOpts.config_id = metaConfig.config_id;

// Callback now reads .code
if (resp.authResponse?.code) {
  await supabase.functions.invoke('meta-oauth-exchange', {
    body: { code: resp.authResponse.code, company_id: selectedCompany.id },
  });
}
```

```ts
// Backend: exchange code with empty redirect_uri (JS SDK flow)
const tokenUrl = new URL(`${FB_GRAPH}/oauth/access_token`);
tokenUrl.searchParams.set('client_id', APP_ID);
tokenUrl.searchParams.set('client_secret', APP_SECRET);
tokenUrl.searchParams.set('redirect_uri', redirect_uri ?? '');
tokenUrl.searchParams.set('code', code);
```

---

## What the user will see after the fix

1. Click **Connect Facebook & Instagram**.
2. The Meta popup loads (no more "isn't available" error).
3. The actual permission screen appears, asking which Pages and Instagram accounts to grant access to.
4. After approval, the Page picker dialog opens in our UI as before, and saving works exactly the same.
