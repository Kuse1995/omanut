## Diagnosis (already confirmed from the database)

The 503s are **not** coming from Omanut, the WhatsApp API, or rate limiting. They're coming from the **OpenClaw tunnel registered against each company** — i.e. the URL the customer's local OpenClaw instance (or your Cloudflare tunnel) is exposed on.

What `openclaw_events.dispatch_error` actually contains for the recent 503s:

```
<h1>no tunnel here :(</h1>
```

That HTML is the standard **localhost.run / lhr.life** "tunnel offline" page. So the dispatch flow is:

```text
Twilio → whatsapp-messages → openclaw-dispatch → POST <company.openclaw_webhook_url>
                                                          │
                                                          ▼
                                          lhr.life / trycloudflare.com tunnel (DEAD)
                                                          │
                                                          ▼
                                                  HTTP 503 "no tunnel here"
```

Webhook URLs currently registered on `companies`:

| Company | Webhook URL | State |
|---|---|---|
| Omanut Technologies | `https://f53c55aa61d799.lhr.life/webhook` | **dead** (lhr.life session expired) → source of the current http_503s |
| Finch, E Library, Art of Intelligence, GreenGrid, ANZ | `https://contributing-prisoners-politics-pontiac.trycloudflare.com/webhook` | **dead** (older trycloudflare tunnel) → source of the older http_530 / DNS errors |
| North Park School | `https://agent.omanut.me/webhook` | alive (the only stable one) |

So:

1. **Is the MCP server receiving outbound dispatch?** No — the requests never reach OpenClaw because the *tunnel in front of OpenClaw* is gone. Omanut's `openclaw-dispatch` is doing the right thing and faithfully reporting the 503 back.
2. **Rate limiting / queue overflow?** No. `trigger_count = 0` on every stuck row, dispatch attempts aren't being retried at all — they fail on the first POST and sit `pending`.
3. **Connection between gateway and WhatsApp API?** Fine. Inbound works, and the only outbound that's currently delivering (North Park) goes through cleanly.
4. **Recent deploys?** Today's deploys touched the WhatsApp router model and MiniMax wiring — none of that changed dispatch URLs or the tunnel layer. The 503s pre-date today's edits (oldest stuck row is from May 7).

## Immediate unblock (no code, you do this)

Re-register the live tunnel for each affected company via the MCP `register_webhook` tool, e.g. for Omanut Technologies:

```json
{ "tool": "register_webhook", "input": { "webhook_url": "https://<your-new-tunnel>/webhook", "mode": "primary" } }
```

If your local OpenClaw isn't running right now, call `clear_webhook` on the dead companies so we stop dispatching into a black hole.

## Code changes I'd like to land in this loop

These prevent the same situation from silently snowballing again. All scoped to `supabase/functions/openclaw-dispatch/index.ts` plus one tiny migration. No UI work, no changes to whatsapp-messages routing logic.

### 1. Detect "dead tunnel" responses and auto-quiet the webhook

When dispatch gets back any of:
- HTTP 503/502/504 with body containing `no tunnel here`, `Tunnel`, `cloudflare`, `Cloudflare Tunnel error`
- DNS error (`failed to lookup address information`)
- HTTP 530

…and that company has had **≥ 5 consecutive dead-tunnel failures**, set `companies.openclaw_webhook_url = null` (or a new `openclaw_webhook_mode = 'off'` if you want to keep the URL for debugging) and write a single boss notification: *"OpenClaw tunnel for <company> has been offline for N attempts — webhook auto-disabled, run register_webhook to re-enable."*

### 2. Mark events `failed` instead of leaving them `pending` forever

After N (=3) failed dispatch attempts on the same event, flip `status` from `pending` → `failed` so:
- `openclaw-pending-trigger` stops re-trying them every minute,
- the dashboard / engagement-watchdog can see the real backlog count.

Add a small index migration on `(status, dispatch_status, created_at)` for the watchdog query.

### 3. Better dispatch_error storage

Right now we store the full HTML error page (the truncated row above is 50+ lines of Cloudflare HTML). Cap to first 500 chars and prefix with the detected reason (`tunnel_offline`, `dns_error`, `http_404`, etc.) so future debugging is one query, not log-diving.

### 4. (Optional) Customer-facing fallback

When a tunnel is detected dead and the inbound message is still inside Twilio's reply window, optionally send the company's configured "we'll get back to you" auto-reply via `send-whatsapp-message` instead of leaving the customer in silence. Off by default behind a `companies.openclaw_dead_tunnel_fallback` flag.

## Out of scope

- No changes to `whatsapp-messages` router (today's MiniMax/router fix stays).
- No changes to the MCP server itself.
- No retroactive re-dispatch of the existing 10+ pending events — once the tunnel is restored, you can mass-retrigger via `openclaw-pending-trigger` and they'll flow through.

## Validation after deploy

1. Send a test WhatsApp to Omanut Technologies → expect `dispatch_status = http_503`, `dispatch_error` prefixed with `tunnel_offline:`.
2. Repeat 5 times → expect `companies.openclaw_webhook_url` set to null + one boss notification.
3. After 3 attempts on the same event → expect `status = 'failed'`.
4. Re-register a live tunnel → next inbound dispatches successfully (`status = answered`).

Want me to proceed with all four changes, or drop #4 (customer-facing fallback)?