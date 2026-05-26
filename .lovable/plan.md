# Fix: OpenClaw responses ignore KB and custom instructions

## Root cause

OpenClaw is pulling events via the MCP tool `list_pending_events`, which currently returns only the raw `inbound_events` row (channel, payload text, conversation_id). It does **not** include:

- Company knowledge base (`quick_reference_info`)
- Voice style / business type / sales mode
- Custom instructions, payment numbers, hours, services
- Recent message history
- BMS snapshot
- Reply guidance ("you ARE the official agent, tool-first, …")

All of that already exists — `buildEnvelope` in `supabase/functions/_shared/openclaw-envelope.ts` produces it for the REST `openclaw-pull` endpoint. The MCP path just bypasses it.

## The fix

Update `list_pending_events` in `supabase/functions/mcp-server/index.ts` to return enriched envelopes built from the same `buildEnvelope` helper used by `openclaw-pull`, instead of raw `inbound_events` rows.

### Changes

**`supabase/functions/mcp-server/index.ts`** — `list_pending_events` tool only:
1. Import `buildEnvelope` from `../_shared/openclaw-envelope.ts`.
2. After fetching the pending rows, loop and call `buildEnvelope(supabase, row)` for each (no `signSecret` needed — MCP auth already verified).
3. Return `{ company_id, count, events: <envelopes> }` where each envelope contains: `event_id`, `company_context` (KB, voice, services, payment numbers, hours), `bms_snapshot`, `recent_history`, `inbound` (text + media), `reply_instructions`, `customer_phone`, `customer_name`, etc.
4. Keep the `channel` filter and `limit` behaviour.
5. Update the tool description to note that each event is a full envelope OpenClaw should ground its reply in.

**No changes** to `mark_event_handled`, the envelope helper, `openclaw-pull`, or anything else. The legacy 401 on `openclaw-pull` stays a separate item.

## Verification

After deploy, call `list_pending_events` from OpenClaw on a company that has KB content (e.g. Omanut Tech) and confirm the returned event includes:
- `company_context.knowledge_base` (non-null)
- `company_context.voice_style`
- `reply_instructions`
- `recent_history` array

Then send a new inbound WhatsApp message that requires KB knowledge (e.g. "what are your hours?") and confirm OpenClaw's reply matches the KB instead of a generic answer.

## Out of scope

- Fixing the `openclaw-pull` REST 401 token issue (separate item; MCP path is sufficient).
- Any UI changes.
- Changing the envelope shape itself.
