# Unblock OpenClaw webhook self-registration — for every company

Approved. Making the fix universal so OpenClaw can register/rotate its tunnel URL for **any** company (current 7 + every future one) without us touching the DB.

## Root cause

`register_webhook` in `supabase/functions/mcp-server/index.ts` (lines 383–410) does a hard pre-flight: it sends a signed POST to the tunnel; anything other than `2xx` is rejected and the URL is **not saved**. Cloudflare/auth-gated tunnels respond with `401/403` at the proxy layer even though OpenClaw's `/webhook` route behind it is healthy. Result: `ping_failed` every time, manual DB update needed per company.

## Fix (applied to the shared MCP tool — automatically covers every company)

Because `register_webhook` is a single MCP tool that resolves `company_id` per call, one change covers all companies — current and future. No per-company config, no migration, no new env vars.

### 1. Treat "reachable but auth-gated" as success

Update the ping logic so these outcomes all save the URL:
- Any `2xx` (current behavior).
- `401`, `403`, `405` — proves the host is up; auth/method mismatch is OpenClaw's internal concern, not ours.
- `404` on the exact `/webhook` path → still fail (real misconfig).

Returned status becomes `ping_status: "delivered" | "reachable_auth_gated" | "error"`.

### 2. Add an explicit `force: boolean` escape hatch

Optional `force` param on the same tool. When `force: true`:
- Still send the ping, capture status.
- Save the URL **regardless** of ping result.
- Return `ok: true` with `ping_warning: "saved without verified reachability"`.

Default stays `force: false` — strict mode for first-time setups that should fail loudly.

### 3. Add `clear_webhook` MCP tool

So OpenClaw can null its own stale tunnel URL on shutdown/rotation:
- Sets `openclaw_webhook_url = null`, `openclaw_mode = 'off'`.
- Resolves `company_id` from MCP context, same as `register_webhook`.

### 4. Document it once in the integration guide

Append a short "Registering / rotating your tunnel" section to `OPENCLAW_INTEGRATION.md` with the two new behaviors, so any new client OpenClaw instance picks the correct call without trial-and-error.

## Why this is permanent for all companies

- The MCP tool is **company-agnostic** — it always operates on whichever company the caller is authenticated for. New companies created via `create-company` automatically get the same `register_webhook` path.
- No per-company toggles, no new columns, no per-company SQL.
- Existing 7 companies (ANZ, Art of Intelligence, E Library, Finch, GreenGrid, North Park, Omanut) gain the fix the moment the function deploys.

## Files touched

- `supabase/functions/mcp-server/index.ts` — relax `register_webhook` ping gate, add `force`, add `clear_webhook` tool.
- `OPENCLAW_INTEGRATION.md` — short "Registering your tunnel" section.

No DB migration. No changes to `openclaw-dispatch`, `openclaw-reply`, or the per-company drafter flow.

## Verification

1. From OpenClaw on the auth-gated Omanut tunnel: call `register_webhook` with no `force` → expect `ok: true, ping_status: "reachable_auth_gated"` and the URL persisted.
2. Send a real WhatsApp to Omanut → confirm `openclaw_events.dispatch_status = 'delivered'`.
3. Repeat from any other company's OpenClaw instance with a different tunnel → same result, no code change needed.
4. Negative check: call with a truly bogus URL (DNS fails) and `force: false` → still rejected (`ping_status: "error"`).
5. Same bogus URL with `force: true` → saved with `ping_warning`.

## Not included

- Not resuming the prior fallback-AI / heartbeat plan in this change (per your earlier "stop this procedure"). We can pick that back up afterward if you want.
