## Goal

Confirm OpenClaw's verifier now accepts our signed payload, then wire the new webhook URL to a pilot company so real events flow.

## Steps

1. **Smoke test** — call `openclaw-debug-sign` with:
   - `target_url`: `https://send-administration-andreas-dogs.trycloudflare.com/webhook`
   - `raw_body`: the same 147-byte test payload from last round
   - Expect `http_status: 200`. Paste result back to OpenClaw.

2. **Wire it up** (only after 200) — update `companies.openclaw_webhook_url` for the pilot company. Need to know which company to point at this URL. Options:
   - ANZ (production retail tenant)
   - A dedicated test company
   - All companies currently in `openclaw_mode='primary'`

3. **End-to-end check** — once URL is wired, send one real WhatsApp/Meta event and verify `openclaw_events.dispatch_status` shows `delivered` (not `http_4xx`).

## Question for user before step 2

Which company should we point at the new tunnel URL? (Cloudflare `trycloudflare.com` URLs are ephemeral — they die when OpenClaw restarts their tunnel, so we should probably only wire this to a test/staging company until they have a stable URL.)

## Out of scope

- No code changes — `openclaw-dispatch` already signs correctly.
- No DB schema changes.
