

User wants OpenClaw to self-diagnose AI failures without burning Lovable prompts / Meta messages on round-trips. OpenClaw itself proposed Track A + MCP code read. Two open questions: code-access route (B1 GitHub vs B2 whitelist) and notify_boss content visibility.

Track B1 (GitHub token) is outside our codebase — user configures it in OpenClaw's UI, no code change needed. B2 (whitelist tool) is one MCP tool we own. Recommend **both**: B1 for full repo, B2 as offline fallback. Cheap to ship.

For notify_boss content: store message body in `boss_conversations` (already happens per `send-boss-notification`) and expose via tool. Phone numbers already in scope (active company gate). Low marginal exposure.

Key safety: all new tools gated by `set_active_company` + `requireOpenClawEnabled` is wrong scope — these are reads, use a lighter `requireOpenClawReadEnabled` or just company gate. Config writes stay locked. Never return raw `system_prompt` field — return `{ has_override: bool, length: int, last_updated: ts }`.

## Plan: 6 new read-only MCP tools + GitHub access

All in `supabase/functions/mcp-server/index.ts`, all gated by active company, all read-only.

### Tools

1. **`get_conversation_trace`** — `{ conversation_id, limit=20 }` → returns last N messages with role, content, tool_calls (name + args + result), errors. Strips any `system` role messages. Lets OpenClaw see exactly why a turn failed.

2. **`get_ai_errors`** — `{ limit=20, since?, search? }` → reads `ai_error_logs` for active company. Returns error type, model, function name, error message, conversation_id, timestamp.

3. **`get_ai_override_summary`** — wraps `company_ai_overrides`. Returns `{ has_system_prompt: bool, prompt_length, banned_topics: [], voice_style, last_updated }`. **Never returns raw prompt content** (confidentiality memory).

4. **`get_boss_notification_history`** — `{ limit=10 }` → reads `boss_conversations` for active company. Returns `{ message_content, created_at, response }`. Lets OpenClaw verify what it actually sent to Abraham.

5. **`get_function_logs`** — `{ function_name, search?, limit=50 }`. Whitelist: `whatsapp-messages`, `mcp-server`, `supervisor-agent`, `boss-chat`, `meta-webhook`, `send-boss-notification`, `send-whatsapp-message`. Calls Supabase analytics API. Returns last N log lines. **Unblocks "AI didn't answer" debugging without round-tripping Lovable.**

6. **`read_function_source`** — `{ function_name, max_bytes=20000 }`. Same whitelist as #5. Reads from disk via `Deno.readTextFile`. Returns source. Truncates large files.

### GitHub access (no code change)

Tell user to add a GitHub read-only Personal Access Token in OpenClaw's MCP/integration settings, scoped to this repo. OpenClaw natively reads GitHub when given a token. Fallback for when it's rate-limited or offline → tool #6.

### Safety

- Every tool: `const companyId = await resolveCompanyId(params?.company_id)` then scope query by `company_id = companyId`.
- Tool #3 never returns raw prompt content.
- Tool #1 filters `role !== 'system'`.
- Tool #5/6 reject any function name not in the whitelist (returns `{ error: "function not in allowlist" }`).
- No new toggle needed — these are reads. Existing `set_active_company` requirement is enough.

### Files to edit

- `supabase/functions/mcp-server/index.ts` — 6 new `server.tool(...)` blocks following the existing pattern.

No DB changes. No new edge functions. No new secrets.

### Verification

1. Reconnect OpenClaw MCP integration → confirm 6 new tools appear in `tools/list`.
2. `get_conversation_trace { conversation_id: <recent failed convo> }` → shows tool calls + errors.
3. `get_function_logs { function_name: "whatsapp-messages", search: "error" }` → returns recent error lines.
4. `read_function_source { function_name: "whatsapp-messages" }` → returns source.
5. `get_ai_override_summary` → returns metadata, **no raw prompt**.
6. Hand OpenClaw a real failure ("AI didn't answer customer X") → it diagnoses without asking Lovable.

