## Goal

Send OpenClaw their exact test payload, signed with our `OPENCLAW_WEBHOOK_SECRET`, so they can compare hex-to-hex and confirm our signing matches.

## Why a new helper function

`openclaw-dispatch` wraps the body (adds `event_id`, `company_name`, `dispatched_at`), so we can't push their exact bytes through it. And we can't sign locally because `OPENCLAW_WEBHOOK_SECRET` only lives in the edge runtime.

## Build

New edge function: `supabase/functions/openclaw-debug-sign/index.ts`

- Input: `{ target_url: string, raw_body: string }` (raw_body is the exact JSON string to sign — not re-parsed).
- HMAC-SHA256 the UTF-8 bytes of `raw_body` with `OPENCLAW_WEBHOOK_SECRET`, hex-encoded.
- POST to `target_url`:
  - `Content-Type: application/json`
  - `X-Openclaw-Signature: sha256=<hex>`
  - `body: raw_body` (verbatim, no JSON.stringify round-trip).
- Return `{ signature, http_status, response_text }`.
- Restrict to admin caller (verify JWT + `has_role(uid,'admin')`) so it can't be used as an open relay.

## Test

Invoke via `supabase--curl_edge_functions`:

```text
POST /openclaw-debug-sign
{
  "target_url": "<OpenClaw webhook URL from companies.openclaw_webhook_url>",
  "raw_body": "{\"event_id\":\"hello\",\"company_id\":\"test\",\"channel\":\"whatsapp\",\"skill\":\"whatsapp\",\"event_type\":\"message_received\",\"payload\":{\"message\":\"test\"}}"
}
```

Paste the returned `signature` + `http_status` + `response_text` into the reply to OpenClaw. If 200, we're done. If 401, share both hexes so they can diff bytes.

## Out of scope

- No further changes to `openclaw-dispatch` (already fixed).
- No DB / RLS / front-end changes.
