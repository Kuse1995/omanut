## Goal

Let a local OpenClaw instance register (and rotate) its own webhook URL via MCP, so the operator never has to touch the Omanut DB when their Cloudflare/ngrok tunnel changes.

## What we'll add

### 1. New MCP tool: `register_webhook`

Exposed in `supabase/functions/mcp-server` alongside the existing session/conversation tools. Schema:

```
{
  webhook_url: string (https URL, required),
  mode?: 'off' | 'assist' | 'primary'   // defaults to current value, or 'assist' on first call
  owns?: {                              // optional skill ownership map
    whatsapp?: boolean,
    meta_dm?: boolean,
    comments?: boolean,
    bms?: boolean,
    content?: boolean,
    handoff?: boolean
  }
}
```

Behavior:
- Resolves `company_id` from the active-company session (admin key) or the pinned company (legacy key) — same pattern as other tools.
- Validates `webhook_url` is `https://` and reachable: sends a tiny signed `ping` event (HMAC-SHA256 with `OPENCLAW_WEBHOOK_SECRET`, 5s timeout). Rejects with a clear error if non-2xx.
- On success, updates `companies` row: `openclaw_webhook_url`, `openclaw_mode`, `openclaw_owns`, and bumps `openclaw_last_heartbeat`.
- Returns `{ company_id, webhook_url, mode, owns, ping_status }`.

### 2. Companion tool: `get_webhook_status`

Read-only — returns current `openclaw_webhook_url`, `openclaw_mode`, `openclaw_owns`, `openclaw_last_heartbeat`, and the last 5 rows from `openclaw_events` (status + dispatch_status) for the active company. Useful for OpenClaw to self-diagnose ("am I wired up correctly?").

### 3. Update `openclaw-skill.json`

Add both tools under a new `webhook_management` section in `tools_overview`, and extend the `session_workflow` doc:

> "First-time setup: after `set_active_company`, call `register_webhook` with your tunnel URL. Re-call it any time your tunnel rotates."

### 4. Update the operator setup prompt

Replace step 3 of the prompt I sent earlier ("Ask the Omanut admin to set companies.openclaw_webhook_url…") with:

> "Call `register_webhook { webhook_url: '<tunnel>/webhook', mode: 'primary', owns: { whatsapp: true, meta_dm: true, comments: true } }`."

## Out of scope

- No DB schema changes — `companies.openclaw_webhook_url`, `openclaw_mode`, `openclaw_owns` already exist.
- No changes to `openclaw-dispatch` — it already reads whatever URL is in the column.
- No UI changes in the admin dashboard.

## Technical details

- File touched: `supabase/functions/mcp-server/index.ts` (add two `mcpServer.tool({...})` blocks).
- Auth: reuses the existing `x-api-key` validation + `set_active_company` resolution already in the MCP server.
- Ping payload mirrors `openclaw-dispatch`'s body shape so OpenClaw's verifier passes unchanged: `{ event_id: 'ping', company_id, channel: 'system', event_type: 'ping', payload: {} }`.
- Heartbeat bump uses the existing `bumpHeartbeat()` helper from `_shared/openclaw-gate.ts`.

## Verification

1. From a local OpenClaw session: `register_webhook` with a fresh trycloudflare URL → expect `ping_status: 'delivered'` and the row updated.
2. Send a real WhatsApp message to the pilot company → confirm `openclaw_events.dispatch_status = 'delivered'` and OpenClaw receives it.
3. Rotate the tunnel, re-call `register_webhook` → confirm next event hits the new URL.
