# OpenClaw → Omanut Integration (Drafter Mode)

OpenClaw no longer sends WhatsApp/Meta messages directly. Omanut owns delivery, retries, and dedupe.
OpenClaw's only job is to **draft a reply** and POST it back.

## The flow

1. Customer sends a message → Omanut (Twilio/Meta) receives it.
2. Omanut calls `openclaw-dispatch` → POSTs to your webhook with full context.
3. Your agent reads `inbound_text` + `recent_history` + `company_brief` and drafts a reply.
4. Your agent POSTs that draft to `reply_to_url` (provided in the dispatch payload).
5. Omanut sends it via the right channel (Twilio / Meta Cloud / Meta DM / FB comment).

## Inbound payload (sent to your webhook)

```json
{
  "event_id": "uuid",
  "company_id": "uuid",
  "company_name": "North Park",
  "company_brief": { "business_type": "retail", "sales_mode": "autonomous" },
  "channel": "whatsapp" | "meta_dm" | "comments",
  "event_type": "inbound_message",
  "conversation_id": "uuid",
  "drafter_mode": true,
  "reply_to_url": "https://dzheddvoiauevcayifev.supabase.co/functions/v1/openclaw-reply",
  "reply_instructions": "Draft a reply and POST it ...",
  "process_now": true,
  "wake": true,
  "customer_phone": "+260977...",
  "customer_name": "Abraham",
  "inbound_text": "do you have stout?",
  "recent_history": [
    { "role": "user",      "content": "hi", "at": "2026-05-05T15:08:00Z" },
    { "role": "assistant", "content": "Hello! How can we help?", "at": "..." }
  ],
  "payload": { "...original Twilio/Meta payload..." }
}
```

## Reply payload (POST to `reply_to_url`)

```json
{
  "event_id": "uuid-from-inbound",
  "reply_text": "Yes — Mosi Stout 750ml is K35.",
  "media_url": "https://... (optional)",
  "action": "send"            // or "handoff" or "skip"
}
```

### Actions

| `action`    | Effect                                                                 |
|-------------|------------------------------------------------------------------------|
| `send`      | Omanut sends `reply_text` (and optional `media_url`) to the customer.  |
| `handoff`   | Omanut pings the boss on WhatsApp; nothing sent to the customer.       |
| `skip`      | Mark the event answered, do nothing.                                   |

## Signing

```
X-Openclaw-Signature: sha256=<hex HMAC-SHA256 of the raw JSON body using OPENCLAW_WEBHOOK_SECRET>
```

Node example:

```js
import crypto from "node:crypto";
const body = JSON.stringify({ event_id, reply_text, action: "send" });
const sig = "sha256=" + crypto.createHmac("sha256", process.env.OPENCLAW_WEBHOOK_SECRET).update(body).digest("hex");
await fetch(reply_to_url, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Openclaw-Signature": sig },
  body,
});
```

## Responses

- `200 { status: "sent", routed_to: "send-whatsapp-message" }` — delivered.
- `200 { status: "already_answered" }` — Omanut had already handled this event (safe to ignore).
- `200 { status: "duplicate_suppressed" }` — same text was just sent; OpenClaw can move on.
- `401 { error: "invalid_signature" }` — fix the HMAC.
- `404 { error: "event_not_found" }` — `event_id` is wrong or expired.
- `502 { status: "failed", error: "..." }` — Omanut tried but the downstream sender errored.

## Per-company toggle

`companies.openclaw_drafter` (boolean, default `true`).
- `true`  → drafter mode (this doc).
- `false` → legacy mode where OpenClaw sends directly via Twilio (kept as a fallback).
