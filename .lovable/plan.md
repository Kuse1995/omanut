

## What's actually going on

OpenClaw's audit is **misleading you**. Here are the facts from the codebase:

### `notify_boss` and `send_media` ARE implemented

They are registered in `supabase/functions/mcp-server/index.ts` at lines 908 and 992 (we shipped them two turns ago and they were deployed). OpenClaw is reporting "Method not found" because **its tool list is stale** — most MCP clients cache the `tools/list` result for a session and don't re-fetch after a server redeploy.

**Fix**: disconnect and reconnect the OpenClaw MCP integration in ChatGPT/Claude (or run the MCP `tools/list` call again). No code change needed.

OpenClaw also gave us hand-written code to "drop in" that uses `boss_whatsapp` and a `whatsapp_credentials` table — neither exists in our schema. We use `company_boss_phones` + Twilio (per the `getBossPhones` shared helper). That code would not work here. Ignore it.

### `lookup_product`, `get_date_info`, `check_availability` are NOT MCP tools by design

They live in `whatsapp-messages/index.ts` as inline tools for the **automated WhatsApp AI**, not the MCP server. OpenClaw should not be calling them — they're scoped to WhatsApp customer chats where the AI also has access to the live conversation, BMS catalog, and reservation tables.

If we want OpenClaw to do the same lookups, we expose them as **new MCP wrappers**, not by claiming the existing ones are broken. (We already have `bms_list_products`, `list_reservations`, etc. — those cover most of it.)

### `bms_generate_payment_link` "Unauthorized"

This isn't an MCP-auth issue. The MCP tool calls the BMS bridge with `BMS_API_SECRET`, and BMS itself enforces RBAC (per the `bms-role-based-access` memory). The active company's BMS user role likely doesn't have `generate_payment_link` permission. To confirm I'd pull recent BMS bridge logs.

## Proposed plan

Three small, independent things — pick any subset:

### A. Verify the MCP tools really are live (no code change)
Hit the deployed MCP endpoint with a `tools/list` call and confirm `notify_boss` and `send_media` are in the response. If yes → the problem is OpenClaw's cache and you reconnect the integration. If no → we redeploy `mcp-server`.

### B. Add the 3 missing MCP wrappers (only if you want OpenClaw to do these)
- `lookup_product` — wraps existing BMS `lookup_product` intent (we already proxy other BMS intents).
- `get_date_info` — pure utility, returns today/tomorrow/weekend dates in `Africa/Lusaka`.
- `check_availability` — queries `reservations` for a given date/time and returns conflicts.

All three gated by company context (no `requireOpenClawEnabled` needed — they're read-only).

### C. Investigate `bms_generate_payment_link` Unauthorized
Pull the last few `mcp-server` + BMS bridge logs for that tool, identify whether it's the BMS role check or a missing `BMS_API_SECRET` for that company, and either grant the role on the BMS side or fix the auth header.

## Recommendation

Do **A first** (30 seconds, no code). It's almost certainly the whole problem for `notify_boss` / `send_media` — OpenClaw is gaslighting you with a cached tool list. Then decide on B and C based on what you actually need OpenClaw to do.

## Files that would change

- **A**: none.
- **B**: `supabase/functions/mcp-server/index.ts` only (3 new `server.tool(...)` blocks following the same pattern as the existing tools).
- **C**: probably `supabase/functions/mcp-server/index.ts` BMS proxy block, plus a config check on the BMS side — depends on what the logs show.

