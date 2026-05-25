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

---

# v2 contracts (added 2026-05-25)

These extend the pull-mode protocol above. None of them break existing OpenClaw clients — fields are additive.

## 1. Persona cache (token-budget contract)

Persona is shipped **once per conversation**, never per tool call.

### Handshake

The first envelope of a conversation (typically the `set_active_company` call) includes the full persona block plus a `persona_key`:

```json
{
  "company_id": "uuid",
  "conversation_id": "uuid",
  "persona_key": "sha256-of-overrides-plus-agent-mode",
  "persona": {
    "system_instructions": "...",
    "tone_voice_guide": "...",
    "escalation_triggers": ["legal threats", "fraud", "..."],
    "qa_style": "...",
    "banned_topics": "..."
  }
}
```

OpenClaw caches the persona keyed by `persona_key` and keeps it in its own working context for the rest of the thread.

### Subsequent envelopes

```json
{
  "company_id": "uuid",
  "conversation_id": "uuid",
  "persona_key": "..."
}
```

No persona body. The Omanut envelope-builder checks `conversations.metadata.persona_key`. If the cached key is stale (because the owner edited `company_ai_overrides`, which bumps `persona_version`), Omanut sets `persona_invalidated: true` and re-attaches the full persona block once. The new `persona_key` should be cached going forward.

## 2. `escalation_triggers` semantics

`escalation_triggers text[]` on `company_ai_overrides` is **prompt-only**. It is inlined into the system instructions under "Escalate to owner when…". There is no trigger → priority mapping table; the AI picks `notify_boss` priority from prompt context exactly as before.

## 3. Sandbox / live gating

`companies.is_live boolean` controls outbound delivery only. Inbound webhooks always flow into `inbound_events` regardless — we need the data to validate the AI loop.

Every Omanut outbound dispatcher (`send-whatsapp-cloud`, `send-twilio-message`, `send-meta-dm`, `send-fb-comment-reply`, `meta-ads-launch`) calls `_shared/is-live-gate.ts → checkIsLive(ctx)` before invoking the provider:

- `is_live = true` → real provider call.
- `is_live = false` → row written to `test_outbound_log` with the full payload + recipient. Surfaced in `/admin/sandbox-console`.

Global escape hatch: `SANDBOX_ENFORCEMENT=off` env var disables the gate entirely.

OpenClaw does not need to know the live state — replies are accepted normally, and Omanut decides whether to dispatch or shadow-log.

## 4. Safety-only mode

When `companies.metadata.sales_mode = 'safety_only'` (or the swarm circuit breaker is open), `_shared/safety-mode-gate.ts → assertOutboundAllowed()` restricts the agent to:

- `notify_boss`
- `bms_who_owes`
- `send_message` (only when `recipient_type = 'owner'`)

Everything customer-facing is rejected. The AI becomes a research assistant for the owner — debt collection notices are drafted by humans, never self-authored.

## 5. Knowledge base sync state

`company_documents` now has:

- `kb_sync_status` — `pending | syncing | synced | failed`
- `kb_sync_error text`
- `kb_synced_at timestamptz`

A trigger on INSERT/UPDATE of `parsed_content` invokes the `embed-document` edge function via `pg_net` (fire-and-forget). `match_documents` filters to `kb_sync_status = 'synced'` only — the AI never serves stale knowledge.

## 6. Image-gen unlock

`companies.image_gen_unlocked boolean` gates image generation in `whatsapp-messages` and `generate-business-image`. It flips true when the company has ≥3 `company_media` rows with `asset_validation_status = 'approved'`. Minimum upload resolution: 800×800.

## 7. Conversation control

No new mirror table. Conversation control lives on the existing `conversations` columns:

- `human_takeover boolean`
- `takeover_at timestamptz`
- `takeover_by uuid`
- **NEW** `paused_reason text`
- **NEW** `paused_until timestamptz` (time-boxed pauses)

OpenClaw and the Omanut admin UI share one source of truth.

## 8. Meta OAuth states

`meta_credentials.connection_state` exposes the real Meta lifecycle:

| State | Meaning |
|---|---|
| `meta_oauth_initiated` | Token exchanged, nothing else done |
| `meta_domain_verification_required` | Show `.well-known/meta` file + meta tag to user |
| `meta_business_verification_pending` | Meta-side review, may take days |
| `meta_whatsapp_number_pending` | Phone ownership SMS/voice code needed |
| `meta_connected` | All green |
| `meta_disconnected` | Tokens revoked or unhealthy |

The wizard treats `meta_business_verification_pending` as a valid resting state, not a failure. Companies in pending states can still use Twilio WhatsApp.

## 9. Feature flags

Every new gate is killable via env var so a single subsystem can be disabled in seconds:

- `SANDBOX_ENFORCEMENT` (default on)
- `APPROVAL_QUEUE_ENABLED`
- `BILLING_TIER_ENFORCEMENT`
- `IMAGE_GEN_GATE_ENABLED`
- `KB_SYNC_FILTER_ENABLED`
- `PERSONA_CACHE_ENABLED`
