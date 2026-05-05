## What I found

- North Park is in OpenClaw primary mode and owns WhatsApp, Meta DM, and comments.
- Inbound WhatsApp events are being created and delivered to OpenClaw with the wake trigger.
- The 30-second retry job is running and re-pinging stale events successfully.
- The latest North Park event was eventually marked answered, but the assistant message says: `MCP parser in script is broken. Triggers ARE arriving.`
- That means the remaining break is no longer Omanut not firing the webhook; it is OpenClaw receiving the wake but not reliably consuming/acting on pending events automatically.

## Plan

1. Strengthen `openclaw-dispatch` payloads
   - Include an explicit `process_now: true`, `wake: true`, and `trigger_reason` field in the JSON body, not only headers.
   - Include enough event data for OpenClaw to act without depending on a fragile MCP/list parser: `event_id`, `conversation_id`, customer phone/name, inbound text, channel, company id/name, and event type.

2. Strengthen `openclaw-pending-trigger`
   - Send the same self-contained payload format on retry.
   - Add clearer retry metadata so OpenClaw can distinguish original wake vs stale-event wake.

3. Add a short-lived safety fallback for stale primary-mode WhatsApp events
   - If a WhatsApp event is delivered to OpenClaw but remains pending after retries, send a boss/internal alert instead of silently stopping.
   - Keep OpenClaw as primary; do not re-enable Omanut AI responses unless explicitly requested.

4. Add observability
   - Log event id, company id, channel, trigger type, retry count, and webhook response status for each OpenClaw trigger.
   - This will make the next failure obvious: delivered-to-OpenClaw vs OpenClaw did not send vs WhatsApp provider failed.

## Validation

- Trigger `openclaw-pending-trigger` manually after changes and confirm it returns candidates/retriggered cleanly.
- Check latest North Park `openclaw_events` and `messages` rows to verify whether an automatic assistant reply appears without using the OpenClaw UI.