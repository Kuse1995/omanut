

## Goal

Fix two real bugs OpenClaw uncovered while pitching to PAUL:

1. The AI promises to "alert the boss" / "escalate hot leads" but the `notify_boss` tool isn't actually implemented in the MCP server, so calls return "Method not found".
2. Same for `send_media` — listed in `enabled_tools`, but no MCP handler exists, so video/image sends from OpenClaw silently fail.

## Investigation needed before plan is final

Before writing code I need to confirm three things in `supabase/functions/mcp-server/index.ts`:

- Whether `notify_boss` and `send_media` are referenced anywhere (definitions vs. just listed in `enabled_tools`).
- The existing tool registration pattern (so the new tools match the gating + auth flow we just used for `generate_business_image`).
- Whether `send-boss-notification` already covers everything `notify_boss` should do (it does — see context: it handles boss phone resolution, Twilio dispatch, and `boss_conversations` logging).

Files I'll read in implementation mode: `supabase/functions/mcp-server/index.ts`, `supabase/functions/send-boss-notification/index.ts`, and the `messaging-conversation-resolution` memory + `send-whatsapp-message` function for the media path.

## Plan

### 1. Implement `notify_boss` MCP tool

Wraps the existing `send-boss-notification` edge function so OpenClaw can fire boss alerts directly.

- Args: `notification_type` (enum from existing function: `interested_client`, `high_value_opportunity`, `customer_complaint`, `vip_client_info`, `action_required`, default `interested_client`), `customer_name`, `customer_phone`, `summary` (free text), optional `priority` (`low`/`medium`/`high`), optional `media_url`.
- Gated by the OpenClaw outbound-actions toggle (`requireOpenClawEnabled`).
- Resolves the active company from MCP session context, then invokes `send-boss-notification` with the right `data` shape per type.
- Returns: `{ success, boss_phones_notified: [...], notification_type }` so OpenClaw can confirm Abraham received it.

### 2. Implement `send_media` MCP tool

Lets OpenClaw send a video/image into a customer WhatsApp conversation (the missing piece behind the failed video sends).

- Args: `conversation_id` OR `customer_phone` (one required), `media_url` (required), optional `caption`.
- Gated by the OpenClaw outbound-actions toggle.
- Internally calls `send-whatsapp-message` (which already auto-resolves/creates the conversation and applies the `whatsapp:` prefix logic from the `twilio-media-message-normalization` memory) with `mediaUrl` + `body`.
- Logs the outbound message into `messages` so it shows up in the inbox like any other reply.
- Returns: `{ success, message_sid, conversation_id }`.

### 3. Sanity check on advertised tools

Walk the `enabled_tools` list in the AI config / system prompt against the actual MCP tool registry. If any other tool is advertised but missing, surface it in the response so we can decide whether to build or remove it. (No code change yet — just a list.)

## Files to edit

- `supabase/functions/mcp-server/index.ts` — register `notify_boss` and `send_media` tools, both gated by `requireOpenClawEnabled`.

No DB changes. No new edge functions — both new tools call existing ones (`send-boss-notification`, `send-whatsapp-message`).

## Verification

1. In OpenClaw: `set_active_company` → ANZ.
2. `notify_boss { notification_type: "high_value_opportunity", customer_name: "PAUL", customer_phone: "+260…", summary: "Picked Pro plan, ready to onboard" }` → Abraham gets the WhatsApp alert; response lists his number under `boss_phones_notified`.
3. `send_media { customer_phone: "+260…", media_url: "https://…/demo.mp4", caption: "Quick demo for you" }` → customer receives the video on WhatsApp; the message appears in the conversation thread in the admin inbox.
4. Re-run with the OpenClaw outbound-actions toggle off → both tools return the standard `OpenClaw outbound actions are disabled` error instead of executing.

