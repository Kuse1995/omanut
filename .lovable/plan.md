

The user wants a single OpenClaw connection where they can verbally switch between companies during a training session. This means:
- One admin-scoped API key (not per-company)
- Tools accept an optional `company_id` parameter
- A `set_active_company` / `list_my_companies` pattern so OpenClaw can hold context within a session
- Admin role gate so only authorized users can issue these keys

Keeping it tight.

---

## Plan: OpenClaw — Train Multiple Companies in One Session

### Goal
One OpenClaw setup. Say "switch to ANZ" → all subsequent tool calls target ANZ. Say "now do E Library" → switches. No file edits, no restart.

### How It Works

1. **Admin-scoped API key** (new) — tied to your admin user, not a single company. Can target any company you have access to.
2. **Two new MCP tools** for company switching:
   - `list_my_companies` — returns all companies you can train
   - `set_active_company` — sets the working company for the rest of the session (OpenClaw remembers it via tool result)
3. **All existing tools** accept an optional `company_id` arg. If omitted, they use the last company you set. If you used a normal (per-company) key, this arg is ignored — backward compatible.

### Typical Session
```
You: "List my companies"
OpenClaw → list_my_companies → [ANZ, E Library, Omanut Tech, ...]

You: "Let's train ANZ. Show recent conversations and AI errors."
OpenClaw → set_active_company(ANZ) → list_conversations → list_ai_errors

You: "Lower temperature to 0.4 and add a rule about stock checks."
OpenClaw → update_ai_config (auto-scoped to ANZ)

You: "Good. Now switch to E Library and do the same review."
OpenClaw → set_active_company(E Library) → list_conversations → ...
```

### Changes

**Database** (migration)
- Add `scope` column to `company_api_keys` (`'company'` default, or `'admin'`).
- Allow `company_id` to be NULL when `scope = 'admin'`.
- Admin keys gated by `has_role(creator, 'admin')` at issue time and re-checked on every request.

**`mcp-server/index.ts`**
- On auth: resolve key → if `admin` scope, verify creator still has admin role; else fall back to current per-company behavior.
- Add `list_my_companies` and `set_active_company` tools.
- Every existing tool: accept optional `company_id`; resolve effective company = `tool arg ?? session active ?? key's company_id`; reject if missing.
- Tenant isolation per call is unchanged — admin scope just lets one key target many companies, RLS still enforced via resolved `company_id`.

**`manage-api-keys/index.ts`**
- Accept `scope: 'admin' | 'company'` on create. Reject `'admin'` if caller lacks `admin` role.

**`ApiKeysSection.tsx`** (Settings → API Keys)
- New **"Generate Admin Training Key"** button (only visible to admins).
- Show scope badge ("Company" / "Admin — All Companies") in the table.
- Add a **"Download OpenClaw skill"** button next to each key — produces a ready-to-paste `omanut-ai.json` with the key pre-filled.

**`openclaw-skill.json`** (template the download generates from)
- Document the new `company_id` arg on every tool.
- Add `list_my_companies` + `set_active_company` to `tools_overview`.
- Add a workflow note: "Start every session with `list_my_companies` then `set_active_company` before any other tool."

### Out of Scope (later, if you want them)
- Training-mode flag on keys (tag test data, exclude from analytics, skip credit deduction).
- Cross-company comparison dashboards (e.g. "AI quality across all my companies this week").
- Bulk apply: "use this prompt change across these 5 companies."

### Security Notes
- Admin keys re-validate the creator's `admin` role on every request — revoking the role immediately disables the key.
- Tenant isolation (`company_id` filtering + RLS) unchanged. Admin scope = ability to *target* any company per call, not bypass policies.
- Key plaintext shown once at creation, same as today.

