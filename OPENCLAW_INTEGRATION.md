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
  "inbound": {
    "text": "do you have stout?",
    "media_urls": ["https://SID:TOKEN@api.twilio.com/.../Media/ME..."],
    "media_count": 1
  },
  "recent_history": [
    { "role": "user",      "content": "hi", "at": "2026-05-05T15:08:00Z" },
    { "role": "assistant", "content": "Hello! How can we help?", "at": "..." }
  ],
  "payload": { "...original Twilio/Meta payload..." }
}
```

> **Media**: `inbound.media_urls[]` contains every image/audio/video the customer just sent.
> Twilio URLs are pre-authenticated (basic-auth credentials inlined) — fetch them with a plain GET.
> Meta URLs are signed by Meta and also work with a plain GET.

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

---

## Knowledge sources in the dispatch payload

Every drafter-mode dispatch now includes everything the agent needs to answer factually — no more blank replies on questions like "what is the tuition?".

### `company_context` (drafter mode only)

```json
"company_context": {
  "name": "North Park School – Solwezi Campus",
  "business_type": "school",
  "sales_mode": null,
  "voice_style": "...",
  "currency_prefix": "K",
  "services": "...",
  "service_locations": "...",
  "hours": "...",
  "branches": "...",
  "payment_instructions": "...",
  "payment_numbers": { "airtel": "...", "mtn": "...", "zamtel": "..." },
  "payments_disabled": false,
  "knowledge_base": "About North Park School ... Tuition Fees per Term ...",
  "knowledge_base_truncated": false
}
```

`knowledge_base` is the curated KB (`companies.quick_reference_info`), capped at 12k chars.

### `bms_snapshot` (when the company has an active BMS connection)

```json
"bms_snapshot": {
  "text": "PRODUCTS & PRICING:\n- ...\nLOW STOCK ALERTS:\n- ...\nSALES OVERVIEW:\n- ...",
  "synced_at": "2026-05-05T20:42:00Z"
}
```

Refreshed lazily — if the cached snapshot on `bms_connections.last_kb_text` is older than 15 min, dispatch re-runs `bms-training-sync` before forwarding.

### `lookup_url` — live lookup endpoint

For anything not in `company_context` or `bms_snapshot`, POST to `lookup_url` (HMAC-signed exactly like `reply_to_url`):

```
POST /functions/v1/openclaw-lookup
X-Openclaw-Signature: sha256=<HMAC-SHA256(body, OPENCLAW_WEBHOOK_SECRET)>

{ "company_id": "...", "intent": "search_kb", "query": "tuition grade 3" }
```

Supported intents: `search_kb`, `check_stock`, `list_products`, `get_pricing`, `low_stock_alerts`, `get_sales_summary`.

### Reply rule

Per the new `reply_instructions`: the agent MUST source answers from `company_context` / `bms_snapshot` / `lookup_url` and only `action: "handoff"` when no source answers the question.
