## Problem

OpenClaw only replies after you message it on its own UI — meaning the agent's loop runs on internal poll, not on our push. Today every inbound (WhatsApp, Meta DM, FB/IG comment) for ANZ + North Park is being **delivered** to OpenClaw's `/webhook` (confirmed: 20/20 recent `openclaw_events` rows show `dispatch_status: delivered`). So the channel routing is fine — the gap is the **process-now signal**.

`openclaw-dispatch` currently fires a second ping at `<base>/execute`. OpenClaw doesn't expose `/execute`, so that ping silently 404s. Result: the agent waits for its own poll cycle before reading the just-delivered event.

## Fix

Two layers, both feeding the same `/webhook` URL:

### 1. Inline trigger (openclaw-dispatch)
- Drop the `/execute` ping entirely.
- The existing single POST to `/webhook` already carries `X-Openclaw-Trigger: process-now` and `X-Openclaw-Priority: immediate` headers for whatsapp / meta_dm / comments / inbound_* events. Confirm the trigger header set covers every inbound channel (whatsapp, meta_dm, comments) and event type (`inbound_message`, `inbound_dm`, `inbound_comment`).
- Add `X-Openclaw-Wake: 1` as an extra hint and keep the 10s timeout.

### 2. Cron safety net (new edge function `openclaw-pending-trigger`)
Runs every 30 seconds via pg_cron. Scans:

```text
openclaw_events
  where dispatch_status = 'delivered'
    and status in ('pending','processing')
    and created_at > now() - interval '10 minutes'
    and (last_trigger_at is null or last_trigger_at < now() - interval '25 seconds')
```

For each row, re-POSTs a signed `process-now` payload to the company's `openclaw_webhook_url` (HMAC-signed with `OPENCLAW_WEBHOOK_SECRET`, headers `X-Openclaw-Trigger: process-now`, `X-Openclaw-Event-Id`, `X-Openclaw-Wake: 1`). Updates `last_trigger_at` and increments `trigger_count` so we throttle and stop after ~5 attempts.

This catches:
- Original webhook delivered but OpenClaw process was asleep / restarted
- Tunnel hiccups (cloudflare trycloudflare URLs flap)
- Future channels added to `openclaw_owns` we forgot to wire

## Schema additions (migration)

`openclaw_events` add:
- `last_trigger_at timestamptz`
- `trigger_count int default 0`
- index on `(dispatch_status, status, created_at desc)` for the cron scan

## Cron registration

`pg_cron` schedule `openclaw-pending-trigger-30s` invoking the new edge function via `net.http_post` every 30 seconds. Registered via `supabase--insert` (per platform rules — contains anon key + project URL).

## Out of scope

- No changes to `whatsapp-messages`, `meta-webhook`, or skill-gating logic — they already hand off to `openclaw-dispatch`.
- No change to OpenClaw side; we just push harder to the URL it already exposes.

## Files touched

- `supabase/functions/openclaw-dispatch/index.ts` — remove `/execute` ping, tighten headers
- `supabase/functions/openclaw-pending-trigger/index.ts` — new
- new migration — schema + index
- pg_cron job inserted via insert tool