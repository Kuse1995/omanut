## Problem

OpenClaw is correctly rejecting our requests with 401. Their verification expects:

```
X-Openclaw-Signature: sha256=<hex HMAC-SHA256 of raw body using OPENCLAW_WEBHOOK_SECRET>
```

But our dispatcher (`supabase/functions/openclaw-dispatch/index.ts`) currently sends the **raw secret** as the header value and never computes an HMAC:

```ts
...(secret ? { 'X-Openclaw-Signature': secret } : {}),
```

So the answer to OpenClaw's two questions is:
1. Yes, we use `OPENCLAW_WEBHOOK_SECRET` — but only as a bearer-style value, not as an HMAC key. That's the bug.
2. The current header is just the raw secret with no `sha256=` prefix. We need to fix it to match the spec.

## Fix

In `supabase/functions/openclaw-dispatch/index.ts`:

1. Serialize the JSON body once into a string (`bodyString`) so the signed bytes match the bytes we send.
2. Compute `sha256=<hex>` using Web Crypto's `crypto.subtle` HMAC-SHA256 with the secret as key and `bodyString` as data.
3. Send:
   - `X-Openclaw-Signature: sha256=<hex>`
   - `body: bodyString` (not a re-stringified object)
4. Keep behavior identical when the secret is missing (skip the header, log a warning).

Pseudocode:

```text
async function signBody(secret, body):
    key = importKey(secret, HMAC-SHA256)
    sig = HMAC(key, body)
    return "sha256=" + hex(sig)

bodyString = JSON.stringify(payload)
sigHeader  = await signBody(secret, bodyString)

fetch(webhookUrl, {
  headers: { 'Content-Type': 'application/json', 'X-Openclaw-Signature': sigHeader },
  body: bodyString,
})
```

## Verification

- Deploy `openclaw-dispatch`.
- Trigger one inbound WhatsApp/Meta event for a company that has `openclaw_mode='primary'` and a webhook URL set.
- Confirm in `openclaw_events.dispatch_status` that the row flips from `http_401` to `delivered` (or whatever 2xx OpenClaw returns).
- Ask OpenClaw to confirm signature now validates.

## Reply to OpenClaw

After the fix is shipped, reply with:

> You were right — the bug was on our side. We were sending the raw secret as the header value instead of an HMAC. Just shipped the fix: we now send `X-Openclaw-Signature: sha256=<hex HMAC-SHA256(rawBody, OPENCLAW_WEBHOOK_SECRET)>`. The signed bytes are the exact JSON string we send as the request body (no re-serialization). Please retry — should pass verification now.

## Out of scope

- No DB changes.
- No changes to the inbound side (we don't receive from OpenClaw via this header — they call our MCP server with bearer auth).
- No changes to the routing/gating logic.
