# OpenClaw → Omanut Integration (v3 — Pull Mode)

OpenClaw no longer needs an inbound tunnel. Omanut hosts the queue; OpenClaw **pulls** events out of it. The reply path is unchanged.

```
Customer ──► Twilio/Meta ──► Omanut webhook ──► inbound_events (pending)
                                                      │
                                       ┌──────────────┼──────────────┐
                                       ▼              ▼              ▼
                                  long-poll          SSE         Realtime
                                       \             │            /
                                        ▼            ▼           ▼
                                              OpenClaw agent
                                                       │ draft
                                                       ▼
                                          POST /openclaw-reply
                                                       │
                                                       ▼
                                       Omanut sends via Twilio / Meta
```

## Auth

All pull endpoints require:

```
Authorization: Bearer <OPENCLAW_GATEWAY_TOKEN>
X-Openclaw-Company: <company_id>      # optional, scope to one tenant
```

The reply endpoint stays HMAC-signed:

```
X-Openclaw-Signature: sha256=<HMAC-SHA256(rawBody, OPENCLAW_WEBHOOK_SECRET)>
```

## Transport 1 — Long-poll (simplest)

```
GET https://dzheddvoiauevcayifev.supabase.co/functions/v1/openclaw-pull?max=10&wait=25
```

Holds the connection up to `wait` seconds; returns immediately when events arrive.

```jsonc
{
  "count": 1,
  "events": [
    {
      "event_id": "uuid",
      "company_id": "uuid",
      "company_name": "North Park",
      "channel": "direct_message",            // direct_message | public_comment | whatsapp
      "source": "meta_dm_fb",
      "company_context": { /* name, hours, payments, knowledge_base, ... */ },
      "bms_snapshot": { "text": "PRODUCTS & PRICING ...", "synced_at": "..." },
      "recent_history": [ { "role": "user", "content": "...", "at": "..." } ],
      "inbound_text": "do you have stout?",
      "inbound": { "text": "...", "media_urls": ["..."], "media_count": 1 },
      "reply_to_url": "https://.../functions/v1/openclaw-reply",
      "lookup_url":   "https://.../functions/v1/openclaw-lookup",
      "reply_instructions": "...",
      "signature": "sha256=..."               // HMAC of the envelope, for verification
    }
  ]
}
```

Loop pattern:

```js
while (true) {
  const r = await fetch(`${BASE}/openclaw-pull?max=10&wait=25`, {
    headers: { Authorization: `Bearer ${TOKEN}`, "X-Openclaw-Company": COMPANY_ID },
  });
  const { events } = await r.json();
  await Promise.all(events.map(draftAndReply));
}
```

## Transport 2 — Server-Sent Events

```
GET https://dzheddvoiauevcayifev.supabase.co/functions/v1/openclaw-stream
```

```js
const es = new EventSource(`${BASE}/openclaw-stream`, {
  headers: { Authorization: `Bearer ${TOKEN}`, "X-Openclaw-Company": COMPANY_ID },
});
es.addEventListener("event", (e) => draftAndReply(JSON.parse(e.data)));
```

The stream closes itself after ~140s — `EventSource` auto-reconnects. Heartbeats arrive every 15s as SSE comments.

## Transport 3 — Supabase Realtime (lowest latency)

Subscribe to `inbound_events` inserts and atomically claim each row via the `claim_inbound_event` RPC. If it returns `false`, another consumer got it — skip.

```js
import { createClient } from "@supabase/supabase-js";
const sb = createClient(URL, SERVICE_ROLE_KEY);

sb.channel("inbound")
  .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "inbound_events", filter: `company_id=eq.${COMPANY_ID}` },
      async ({ new: row }) => {
        const { data: claimed } = await sb.rpc("claim_inbound_event", { _event_id: row.id, _claimed_by: "openclaw" });
        if (!claimed) return;
        // Build the same envelope as pull/stream returns, then POST to reply_to_url.
      })
  .subscribe();
```

## Replying

Same as before — POST to `reply_to_url` with HMAC signature:

```jsonc
{
  "event_id": "uuid-from-envelope",
  "reply_text": "Yes — Mosi Stout 750ml is K35.",
  "media_url": "https://...",   // optional
  "action": "send"               // or "handoff" | "skip"
}
```

Responses are unchanged: `sent` / `already_answered` / `duplicate_suppressed` / `invalid_signature` / `event_not_found`.

## Failover

If OpenClaw doesn't claim an event within **`OPENCLAW_PULL_GRACE_SECONDS`** (default `8s`), Omanut's in-house worker takes over and replies using the same swarm/AI it would have. Customers always get a reply.

Stuck `processing` rows (consumer claimed but never replied) are released back to `pending` after 60s by a Postgres cron job.

## Deprecated

- `companies.openclaw_webhook_url`, `openclaw_mode`, `openclaw-dispatch` push path — superseded by pull. Kept for one release as best-effort `notify_only` mirror.
- `register_webhook` MCP tool — no longer required; OpenClaw self-registers as a consumer just by calling the pull endpoints with its token.
