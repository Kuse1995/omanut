## Goal

Flip OpenClaw from a **direct sender** into a **reply-drafter**. Omanut stays the only system that talks to the customer on WhatsApp/Meta, which removes every class of bug we've been fighting (parser fragility, missing wake pings, stuck pending events, double messages).

## New flow

```text
Customer  ──►  Twilio/Meta  ──►  Omanut (whatsapp-messages / meta-webhook)
                                          │
                                          │ 1. log inbound, mark pending
                                          ▼
                                   openclaw-dispatch
                                          │ HTTP POST {event_id, text, phone, history}
                                          ▼
                                     OpenClaw agent
                                          │ drafts reply (no sending)
                                          ▼
                            POST /functions/v1/openclaw-reply
                              { event_id, reply_text, media?, action? }
                                          │
                                          ▼
                          Omanut validates + sends via Twilio/Meta
                                          │
                                          ▼
                                     Customer ✅
```

OpenClaw never touches Twilio. Omanut owns delivery, retries, dedupe, and the audit trail.

## What changes

### 1. New edge function: `openclaw-reply` (inbound from OpenClaw)
- Verifies HMAC signature using `OPENCLAW_WEBHOOK_SECRET`
- Body: `{ event_id, reply_text, media_url?, action?: 'send'|'handoff'|'skip', metadata? }`
- Looks up the `openclaw_events` row → resolves `company_id`, `conversation_id`, `customer_phone`, channel
- Calls existing senders:
  - WhatsApp → `send-whatsapp` / `send-whatsapp-cloud` (per `companies.whatsapp_provider`)
  - Meta DM → `meta-send-dm`
  - Comments → `meta-reply-comment`
- Writes the assistant message into `messages` / `whatsapp_messages` so the inbox shows it
- Marks event `status='answered'`, stores `reply_text` in payload for audit
- Dedupe: ignore if event already `answered` or if same `reply_text` was sent in last 30s

### 2. `openclaw-dispatch` payload — make it draft-friendly
Add fields OpenClaw needs to write a good reply without calling back:
- `recent_history`: last 8 messages (role + text) from `messages`
- `customer_profile`: name, segment, tags, last order
- `company_brief`: name, business_type, sales_mode
- Keep existing `process_now`, `wake`, `customer_phone`, `inbound_text`

### 3. Cron / retry simplification
- `openclaw-pending-trigger` keeps re-pinging only events that have **no reply** after 30s
- Boss-fallback alert now fires when OpenClaw fails to **post a reply back** (not when it fails to send) — much cleaner signal
- Drop `MAX_TRIGGERS=5` to `3` since OpenClaw now has a single, simple job

### 4. Company config flag
Add `companies.openclaw_mode = 'drafter' | 'sender' | 'off'`:
- `drafter` (new default for North Park): OpenClaw drafts, Omanut sends
- `sender` (legacy): OpenClaw sends directly (kept for fallback)
- `off`: Omanut handles everything itself

UI toggle lives in the existing OpenClaw card on the company page.

### 5. OpenClaw side (you do this)
Update the agent to:
- Stop calling Twilio
- After drafting, `POST {SUPABASE_URL}/functions/v1/openclaw-reply` with HMAC signature
- That's it — no polling, no MCP tools needed for sending

I'll generate the exact endpoint URL, signing snippet, and a sample payload in a small `OPENCLAW_INTEGRATION.md` so you can paste it into the agent prompt.

## Why this wins

| Problem today | Fixed by |
|---|---|
| OpenClaw parser misses `wake=1` → no reply | OpenClaw doesn't need to act on pings; it just drafts whenever it sees an event |
| Stuck pending events sit silent | Boss alert triggers on missing **reply**, not missing **send** |
| Double sends / wrong number | Only Omanut sends, using verified Twilio creds |
| No audit of what OpenClaw said | Reply text logged in `openclaw_events.payload.reply_text` + `messages` |
| Twilio creds shared with OpenClaw | Removed — OpenClaw needs only the Supabase function URL + secret |

## Out of scope (explicit)

- No change to `whatsapp-messages` inbound parsing
- No change to Meta webhook plumbing
- No change to BMS / image-gen tool gating

## Open question

Should `openclaw-reply` also accept **tool calls** (e.g. "search BMS, then reply")? My suggestion: **no for v1** — keep OpenClaw to plain-text drafts; Omanut already has BMS/media/handoff tools and we can layer that later if needed.

Ready to build this?