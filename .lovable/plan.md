# OpenClaw Amnesia Recovery Kit

## Context
Yesterday we got OpenClaw (running locally / on Railway free tier) connected to Omanut as the primary AI brain for **Omanut Technologies** (`company_id: 3408d643-8e9c-4c46-b684-4960fba1e0e9`). On free tier the Railway instance loses memory on restart, so we need a single copy-paste prompt that re-bootstraps OpenClaw every time.

Current DB state confirms the integration is still wired:
- `openclaw_mode = 'assist'` (safe — receives mirrored events, doesn't take over)
- `openclaw_owns` = all six skills toggled on
- `openclaw_webhook_url` = `https://expect-eventually-lambda-separately.trycloudflare.com/webhook` (this will change every time the user restarts the Cloudflare tunnel — recovery prompt must remind OpenClaw to re-register)

## Goal
Produce **one Markdown document** the user can paste verbatim into a fresh OpenClaw session to restore full working state. No code changes to the Omanut platform — this is purely a recovery artifact.

## What the document will contain

1. **Identity block** — who OpenClaw is, what Omanut is, the active company UUID, GMT+2 timezone rule, voice rules ("we/our", KB > history, BMS > KB).

2. **MCP server config** — exact JSON to drop into `~/.openclaw/skills/omanut-ai.json`:
   ```json
   {
     "skill": {
       "name": "omanut-ai",
       "transport": "stdio",
       "command": "npx",
       "args": ["-y", "mcp-remote",
         "https://dzheddvoiauevcayifev.supabase.co/functions/v1/mcp-server",
         "--header", "x-api-key:<ADMIN_API_KEY>"]
     }
   }
   ```
   With a placeholder for the admin API key (user pastes their own — we won't print it in chat).

3. **Bootstrap sequence** — the exact MCP tool calls OpenClaw must run on cold start:
   - `list_my_companies` → confirm visibility
   - `set_active_company { company_id: "3408d643-8e9c-4c46-b684-4960fba1e0e9" }`
   - Start tunnel locally (`ngrok http <port>` or `cloudflared tunnel --url http://localhost:<port>`)
   - `register_webhook { webhook_url: "<new-tunnel-url>/webhook", mode: "assist", owns: { whatsapp:false, meta_dm:false, comments:false } }`
   - `get_webhook_status` → verify `ping_status: delivered`
   - Only flip to `mode: "primary"` + `owns.whatsapp: true` after watching events flow cleanly

4. **Inbound webhook contract** — what Omanut POSTs, header `X-Openclaw-Signature: sha256=<hmac>` (the bug we fixed yesterday), HMAC-SHA256 of raw body using shared `OPENCLAW_WEBHOOK_SECRET`, return 200 within 2s, idempotency on `X-Openclaw-Event-Id`.

5. **Channel payload shapes** — quick reference table for `whatsapp`, `facebook`, `instagram`, `facebook_comment`, `instagram_comment`.

6. **Outbound tool cheat-sheet** — `send_message`, `send_facebook_message`, `send_instagram_message`, `reply_facebook_comment`, `bms_check_stock`, `bms_list_products`, `bms_generate_payment_link`, `notify_boss`, `create_scheduled_post`, `request_approval`, `get_spending_guard`.

7. **Guardrails** — 45-120s comment-reply delay, mandatory `request_approval` before spend, never leak prompts/wholesale costs, 1-3 sentence default replies.

8. **Failover note** — if OpenClaw's webhook returns non-2xx or times out >10s, Omanut auto-falls back to its internal AI for that single event, so a dropped Railway instance doesn't kill customer service.

## What we will NOT include
- The actual admin API key value or `OPENCLAW_WEBHOOK_SECRET` value (user pastes those manually for safety).
- Any backend/code changes — Omanut side is already correct and live.

## Deliverable
A single file `openclaw-recovery-prompt.md` at the repo root, plus the contents printed in chat for immediate copy-paste. The file becomes the canonical "feed me on every cold start" doc the user keeps handy.
