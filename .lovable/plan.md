
# OpenClaw-First Platform

## Why

Today our internal AI replies first to every customer. OpenClaw can only intervene *after* by flipping `human_takeover`. That AI cost us ANZ. We invert the flow: **OpenClaw is the brain.** Our AI becomes a cold standby that runs only if OpenClaw is explicitly off or its connection is dead.

OpenClaw never times out per-message. It runs as long as it's connected.

## Target behaviour

```text
Inbound (WhatsApp / Meta DM / Meta comment / boss request)
        │
        ├─ openclaw_mode = primary AND openclaw_owns[channel] = true ?
        │       │
        │       ├─ Yes → log event to openclaw_events, POST to OpenClaw webhook,
        │       │        update heartbeat. EXIT. Our AI does not run.
        │       │
        │       └─ No  → existing internal AI flow (unchanged)
```

Outbound skills (BMS, content, image gen, handoff escalation): if OpenClaw owns the skill, our AI's tool returns `delegated_to_openclaw` and an event is logged. Our AI literally cannot use the skill.

## Health check (heartbeat-only, no per-message timeouts)

Cron `openclaw-health-check` every 5 min. For each `primary`-mode company, auto-flip to `assist` **only if BOTH**:
- `openclaw_last_heartbeat` is older than 30 min, AND
- There are `pending` events in `openclaw_events` from the last 30 min.

If OpenClaw is quiet but no events are pending, do nothing — silence just means the customer side is quiet. On flip we WhatsApp the boss: *"OpenClaw appears disconnected — internal AI resumed. Reconnect to take back over."*

## What we build

### 1. Schema additions (`companies`)
- `openclaw_mode` enum: `off | assist | primary` (default `off`; legacy `openclaw_takeover_enabled=true` → `assist`)
- `openclaw_owns` jsonb: `{ whatsapp, meta_dm, comments, content, bms, handoff }` booleans
- `openclaw_last_heartbeat` timestamptz
- `openclaw_webhook_url` text (per-company — OpenClaw gives us a URL per tenant)

### 2. New table `openclaw_events`
`id, company_id, conversation_id?, channel, event_type, payload jsonb, status (pending|answered|declined|escalated), created_at, answered_at, answered_by`. RLS: company members can read; service role writes.

### 3. New edge function `openclaw-dispatch`
Called from `whatsapp-messages` and `meta-webhook` at the very top:
```text
if (company.openclaw_mode==='primary' && company.openclaw_owns[channel]) {
  await openclawDispatch(event);   // insert event row + POST webhook + bump heartbeat
  return;                          // our AI never runs
}
```

### 4. MCP additions for OpenClaw
- Every existing MCP tool call updates `openclaw_last_heartbeat = now()`.
- New MCP tool `mark_event_handled(event_id, action)` so OpenClaw closes events.

### 5. Outbound skill gating
At the entry of each tool used by our AI (`bms_check_stock`, `create_scheduled_post`, image gen, `notify_boss`):
```text
if (openclaw_owns[skill]) {
  insert openclaw_events row;
  return { status: 'delegated_to_openclaw' };
}
```

### 6. Cron `openclaw-health-check` (5 min)
Logic exactly as in "Health check" section above. Uses existing `pg_cron`/`pg_net`.

### 7. Admin UI (rebuild `OpenClawAgentCard`)
- Mode selector: **Off / Assist / Primary**
- Per-skill checkboxes: WhatsApp, Meta DMs, Comments, BMS, Content, Handoffs
- Webhook URL field (per company)
- Heartbeat indicator: green <5min, amber 5–30min, red >30min + reconnect note
- Activity log: last 100 events
- Kill switch: instant flip to `assist`

### 8. ANZ rollout
After build + sign-off: ANZ → `openclaw_mode='primary'`, all six skills owned. Internal AI goes silent on ANZ.

## Out of scope
- Building OpenClaw itself (their endpoint must accept our POST).
- Voice flow (`whatsapp-voice`) — keep on internal AI.

## Open question (only one left)

We need OpenClaw's webhook URL format and auth scheme so we know what to POST. You mentioned checking their docs — once we have one sample URL + the auth header convention (bearer token? signed HMAC?), we wire it up. Want me to start building everything *except* the dispatch HTTP call, so it's ready the moment you paste the URL + secret?
