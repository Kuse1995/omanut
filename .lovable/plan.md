

OpenClaw says all tools except `list_my_companies` and `set_active_company` are returning `-32603 Internal Error`. Let me check the MCP server code to confirm.
<lov-tool-use id="toolu_vrtx_01TCjxVt9RcsKxLWMbJUbkwP" name="code--view" integration-id="code" data="{\"file_path\": \"supabase/functions/mcp-server/index.ts\", \"lines\": \"1-100\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01DuzTTvEtTBnbnJ22w82RJ3" name="code--exec" integration-id="code" data="{\"command\": \"wc -l supabase/functions/mcp-server/index.ts\", \"user_facing_description\": \"Checking MCP server file size\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_014mwwvYi6Hbph4hRJ3YRhLq" name="supabase--analytics_query" integration-id="supabase" data="{\"query\": \"select id, function_edge_logs.timestamp, event_message, response.status_code, request.method from function_edge_logs cross join unnest(metadata) as m cross join unnest(m.response) as response cross join unnest(m.request) as request where m.function_id = '6d11e92d-8f93-40da-ba7f-f6ea16d13d86' order by timestamp desc limit 50\"}">
</lov-tool-use>
All HTTP responses are 200/202 — no 5xx. So tool errors are returned in JSON-RPC body as `-32603`. Let me look at the tool handlers and how they handle errors.
<lov-tool-use id="toolu_vrtx_014yiTXxpngkpAbfmfK3nMgZ" name="code--search_files" integration-id="code" data="{\"query\": \"32603|throw new Error|catch \\\\(\", \"search_dir\": \"supabase/functions/mcp-server\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01ThBoPwu6uYBjzqdLcAcQ6r" name="code--view" integration-id="code" data="{\"file_path\": \"supabase/functions/mcp-server/index.ts\", \"lines\": \"1-150\"}">
</lov-tool-use>
I see the issue. When admin calls a non-`list_my_companies` tool without first calling `set_active_company` and without passing `company_id`, `resolveCompanyId` throws "No active company set." This becomes -32603 Internal Error in MCP. The session-id must also be matching across requests — but `mcp-remote` may use different session IDs or the in-memory map gets reset on cold starts.

Let me check more.
<lov-tool-use id="toolu_vrtx_019xQzsSaeAWNT9cjqKXkxw6" name="code--view" integration-id="code" data="{\"file_path\": \"supabase/functions/mcp-server/index.ts\", \"lines\": \"1050-1137\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01Fn7mgSRM5eMFiGMpLMY69Z" name="code--search_files" integration-id="code" data="{\"query\": \"sessionId|mcp-session-id|generateSession\", \"search_dir\": \"supabase/functions/mcp-server\"}">
</lov-tool-use>
Now I understand the architecture. Two issues likely:

1. **In-memory `adminSessionActiveCompany` Map is lost on cold starts** between edge function invocations. So `set_active_company` writes to memory, but next request hits a fresh instance and the active company is gone → "No active company set" → -32603.

2. Even within a warm instance, `mcp-remote` may not preserve the same `mcp-session-id` across calls reliably — and the fallback `key:${keyId}` is shared across all admin sessions so it could work but won't survive cold starts.

Let me confirm by checking a recent failing tool call. Actually the diagnostic is strong enough already. The user reported "list_my_companies and set_active_company work, all others fail." Classic stateless-function symptom.

**Fix**: Persist active company in the database keyed by `(api_key_id, session_id)` instead of in-memory Map.
<lov-tool-use id="toolu_vrtx_01PtnWdtgEEvxusDjoP4V8qQ" name="code--view" integration-id="code" data="{\"file_path\": \"supabase/functions/mcp-server/index.ts\", \"lines\": \"180-240\"}">
</lov-tool-use>
I have enough. The diagnosis is clear. Plan:

<lov-plan>

## Diagnosis

OpenClaw is right that the MCP server is returning JSON-RPC `-32603 Internal Error` on every tool call except `list_my_companies` and `set_active_company`. I traced it to a state-management bug — not a per-company data crash.

**Root cause**: The MCP server stores the admin's "active company" choice in an **in-memory `Map`** inside the edge function:

```ts
const adminSessionActiveCompany = new Map<string, string>();
```

Edge functions are stateless and recycle frequently. When you call `set_active_company`, it writes to memory in *that* invocation. The next tool call (e.g. `list_conversations`) lands on a **fresh edge function instance** — the Map is empty, the active company is gone, and `resolveCompanyId()` throws:

> "No active company set. Call list_my_companies, then set_active_company first..."

`mcp-lite` wraps the thrown error as `-32603 Internal Error` instead of surfacing the message — so OpenClaw can't see *why* it failed and assumes the server is crashing on company data.

**Why `list_my_companies` works**: it doesn't call `resolveCompanyId()`.
**Why `set_active_company` "works"**: it writes to the dead Map and returns success — the failure shows up on the *next* call.

## Fix

Three coordinated changes:

### 1. Persist active company in the database (not memory)
- Add a tiny table `mcp_active_company` keyed by `(api_key_id, session_id)` with `company_id` and `updated_at`.
- `set_active_company` upserts a row.
- `resolveCompanyId` reads it via a fast lookup.
- Survives cold starts and matches whatever `mcp-session-id` `mcp-remote` sends (or the `key:<id>` fallback).

### 2. Surface real errors instead of `-32603`
- Wrap every tool handler so `throw new Error("...")` becomes a structured tool result:
  ```json
  { "ok": false, "error": "No active company set...", "hint": "Call set_active_company first" }
  ```
- Return it as `content` with `isError: true` so OpenClaw sees the actual message instead of "Internal Error".

### 3. Auto-default for admin when only one tool target makes sense
- If admin calls a tool without `company_id` and no active company is set, return a clean error that lists `list_my_companies` + `set_active_company` as the next step — instead of crashing with a generic message.
- Update `who_am_i` and `list_my_companies` responses to include `next_step` guidance so OpenClaw self-recovers.

## What OpenClaw will do after the fix

1. `who_am_i` → confirms admin scope.
2. `list_my_companies` → returns 6 companies + `next_step: "set_active_company"`.
3. `set_active_company { company_id: "..." }` → persists to DB.
4. Any tool (`list_conversations`, `get_company_overview`, etc.) → reads active company from DB, runs successfully.

## Files to edit

- **New migration**: create `mcp_active_company` table (no RLS — service role only).
- `supabase/functions/mcp-server/index.ts`:
  - Replace in-memory `Map` with DB upsert/select for `(key_id, session_id) → company_id`.
  - Add a `safeTool()` wrapper that catches errors and returns structured `isError` content.
  - Add `next_step` hints in `who_am_i`, `list_my_companies`, and the "no active company" error.

## Verification

After deploy, in OpenClaw:
1. `who_am_i` → admin scope confirmed.
2. `list_my_companies` → 6 companies.
3. `set_active_company` for E Library.
4. `list_conversations` → returns conversations (no -32603).
5. `set_active_company` for Finch Investments → switch succeeds, next tool targets Finch.

