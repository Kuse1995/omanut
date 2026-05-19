
# OpenClaw v3 — Pull-Based Inbound, Drop the Tunnel

## Why

Today Omanut **pushes** every inbound WhatsApp/Meta event to each customer's `openclaw_webhook_url`. Customer tunnels are the single biggest source of failure (404 / 530 / 502 / timeouts). The reply path (`openclaw-reply`) already works fine because it's OpenClaw calling *us*.

The fix is symmetric: make the **inbound** path also OpenClaw → Omanut. OpenClaw runs no inbound webhook, no tunnel, no exposed port. It connects out to Omanut, claims pending events from `inbound_events`, drafts a reply, POSTs it to `openclaw-reply`. Done.

```text
Customer ──► Twilio/Meta ──► Omanut webhook ──► inbound_events (pending)
                                                       │
                                          ┌────────────┼────────────┐
                                          ▼            ▼            ▼
                                   long-poll        SSE        Realtime
                                          \         │          /
                                           ▼        ▼         ▼
                                              OpenClaw agent
                                                     │ draft
                                                     ▼
                                          POST /openclaw-reply
                                                     │
                                                     ▼
                                       Omanut sends via Twilio / Meta
```

## Scope

- **In:** Replace push-to-tunnel with pull endpoints. Three transports (OpenClaw chooses). Drop `openclaw-dispatch` push path entirely.
- **Out:** No changes to the AI itself, the reply path, the queue table schema, or the existing `openclaw-worker` (which keeps running as the in-house fallback brain).

## Architecture

### 1. Three pull transports, all reading the same `inbound_events` queue

| Transport | Endpoint | Use case |
|---|---|---|
| **Long-poll** | `GET /openclaw-pull?max=10&wait=25` | Simplest. OpenClaw polls; we hold the connection up to 25s if queue is empty, return as soon as events appear. |
| **SSE stream** | `GET /openclaw-stream` | Persistent connection. We push event JSON as `data:` frames the moment rows land. Auto-resume via `Last-Event-Id`. |
| **Supabase Realtime** | Direct subscription to `inbound_events` (filtered by `company_id`) using a scoped key OpenClaw already has. | Lowest latency, zero infra. |

All three return the **same event envelope** that today's dispatch payload uses (`event_id`, `company_id`, `channel`, `inbound_text`, `recent_history`, `company_context`, `bms_snapshot`, `reply_to_url`, `lookup_url`, signed). Only the delivery mechanism differs.

### 2. Claim semantics

`/openclaw-pull` and `/openclaw-stream` atomically:
1. `UPDATE inbound_events SET status='processing', claimed_by=$worker_id, claimed_at=now() WHERE id IN (SELECT id FROM inbound_events WHERE status='pending' AND company_id=$cid ORDER BY created_at LIMIT $max FOR UPDATE SKIP LOCKED) RETURNING *`
2. Existing `openclaw-worker` cron stays as a safety net: any `processing` row stuck >60s is reset to `pending` so another consumer (or our in-house worker) picks it up.

Realtime subscribers see the INSERT, then call a new `claim_event(event_id)` RPC to flip the row to `processing`; if RPC returns 409 they skip (someone else got it).

### 3. Auth

- Pull endpoints require `Authorization: Bearer <OPENCLAW_GATEWAY_TOKEN>` (already exists) + `X-Openclaw-Company: <company_id>`.
- Realtime: scoped Supabase key + RLS policy `company_id IN (openclaw allowed list)`.

### 4. Reply path: unchanged

OpenClaw keeps POSTing to `reply_to_url` (`openclaw-reply`). That endpoint already marks the event `sent` and sends via Twilio/Meta. No change.

### 5. Drop the push path

- `openclaw-dispatch` is **deleted** (or stubbed to 410 Gone for one release).
- `companies.openclaw_webhook_url` column is dropped after one release.
- `meta-webhook` and `whatsapp-messages` no longer call `supabase.functions.invoke('openclaw-worker', { body: { event_id } })` for OpenClaw's benefit — they only enqueue. The worker still runs on cron to handle companies that don't have OpenClaw connected, and to recover stuck rows.
- `MetaIntegrationsPanel` "register webhook URL" UI is removed. OpenClaw self-registers as a consumer by simply calling the pull endpoints with its token.

## Files

### New
- `supabase/functions/openclaw-pull/index.ts` — long-poll endpoint
- `supabase/functions/openclaw-stream/index.ts` — SSE endpoint
- `supabase/migrations/<ts>_openclaw_pull.sql`
  - `claim_event(event_id uuid)` RPC
  - `release_stuck_events()` function + cron (60s) for `processing` >60s
  - RLS policy on `inbound_events` for the OpenClaw role
  - drop `companies.openclaw_webhook_url`, `companies.openclaw_mode` (after grace period — keep nullable for now)
- `OPENCLAW_INTEGRATION.md` — rewritten for pull model with code samples for all 3 transports

### Edited
- `supabase/functions/meta-webhook/index.ts` — drop the legacy `openclaw-dispatch` fallback branch; enqueue only.
- `supabase/functions/whatsapp-messages/index.ts` — same: enqueue, no dispatch.
- `supabase/functions/openclaw-worker/index.ts` — keep, but it now only processes events still `pending` after `OPENCLAW_PULL_GRACE_SECONDS` (default 8s). This gives OpenClaw first dibs; we take over only if it didn't pull.
- `src/components/admin/MetaIntegrationsPanel.tsx` + `src/components/admin/OpenClawAgentCard.tsx` — remove tunnel-URL inputs; show token + endpoints instead.
- `src/pages/admin/EventQueue.tsx` — add column "Consumed by" (openclaw vs in-house worker) for visibility.

### Deleted
- `supabase/functions/openclaw-dispatch/index.ts`

## Rollout

1. Ship pull endpoints + grace-period in worker. Tunnels still allowed but become best-effort mirror for one release.
2. Switch OpenClaw to pull (their side).
3. Delete `openclaw-dispatch` and drop the columns.

## Open question for you

Grace period before our in-house worker takes over an event OpenClaw could have pulled — start at **8 seconds**? Lower = faster fallback, higher = more chance OpenClaw handles it itself.
