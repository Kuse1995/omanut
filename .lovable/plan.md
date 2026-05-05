# Fix: OpenClaw can't find KB info — make it use its tools

## Real root cause

You are right — OpenClaw already has tools. They just don't see the data, for two reasons:

1. **`search_knowledge_base` MCP tool only scans `company_documents.parsed_content`.**
   North Park's tuition fees live in `companies.quick_reference_info` (the curated KB editor in the dashboard), NOT in `company_documents`. So even if the agent calls `search_knowledge_base("tuition")`, it returns `[]` — the field it's searching is empty for most companies.

2. **The dispatch payload tries to do the work for the agent** (12k KB blob inlined, top-level duplicates, "MANDATORY RULE…" prompts). The agent ignores the blob and falls back to a templated "contact admissions". Stuffing more context has not fixed this — we already tried twice.

Your instinct is correct: stop pre-stuffing, make the agent fetch what it needs through tools that actually return the right data.

## Plan

### 1. Fix `search_knowledge_base` so it actually finds KB content

Update the MCP tool in `supabase/functions/mcp-server/index.ts` to scan **all** company knowledge sources, mirroring what `openclaw-lookup`'s `search_kb` already does:

- `companies.quick_reference_info` (the big curated KB — this is where tuition fees live)
- `companies.payment_instructions`
- `companies.services`, `hours`, `branches`, `service_locations`
- `bms_connections.last_kb_text` (live BMS catalog snapshot)
- `company_documents.parsed_content` (existing behavior)

Return ranked snippets (paragraph-level, scored by keyword hits, top 8) tagged with their source. Same algorithm as `openclaw-lookup`, just exposed as the MCP tool the agent already knows about.

### 2. Add a real BMS-aware lookup tool to MCP

Add `search_bms_catalog` (or extend `bms_list_products` / `bms_check_stock` with a free-text `query`) so the agent can answer "do you have X?" without needing to know exact product names.

### 3. Slim the dispatch payload + tell the agent to use tools

In `supabase/functions/openclaw-dispatch/index.ts`:

- **Stop inlining `knowledge_base` (12k chars) and `bms_catalog`** at the top level. Keep only a tiny `kb_summary` (first 800 chars) as a hint of what's available.
- Replace the long "MANDATORY RULE" prose with a short, tool-first instruction:

  > "Before drafting, call `search_knowledge_base({ query })` for any factual question (fees, prices, hours, policies, contacts). For product/stock questions also call `bms_check_stock` or `bms_list_products`. Quote what you find verbatim. Only escalate via `action: 'handoff'` if both tools return empty."

- Keep `lookup_url` as a fallback for agents that prefer direct HTTP, but the primary path is MCP tools (faster, already authenticated, already in the agent's context).

### 4. Update `OPENCLAW_INTEGRATION.md` and `openclaw-skill.json`

- Document the expanded `search_knowledge_base` behavior (now scans curated KB + BMS, not just documents).
- Add a "Drafter Mode workflow" section: receive event → `search_knowledge_base` → optional BMS tool → draft → POST to `reply_to_url`.

## Technical details

**Files**
- `supabase/functions/mcp-server/index.ts` — rewrite `search_knowledge_base` handler; optionally add `search_bms_catalog`
- `supabase/functions/openclaw-dispatch/index.ts` — drop the 12k inline KB/BMS, shorten `reply_instructions`, keep `lookup_url` as fallback
- `OPENCLAW_INTEGRATION.md` + `openclaw-skill.json` — document new behavior

**No schema changes.** `bms_connections.last_kb_text` already exists from the previous migration.

**Why this fixes North Park's miss**
- Today: agent receives "knowledge_base: <12k blob>", ignores it, says "contact admissions". `search_knowledge_base("tuition")` returns `[]` because the data isn't in `company_documents`.
- After: agent calls `search_knowledge_base("grade 7 fees")` → tool scans `quick_reference_info` → returns the "Grade 5–7 – K2,100" paragraph with source tag → agent quotes it.

## Validation

After deploy, ask North Park: "how much is grade 5 fees?"
- Inspect `openclaw_events.payload` — should be small, no 12k blob.
- Inspect MCP tool call logs — should see a `search_knowledge_base` call.
- Reply should contain the exact K-amount from `quick_reference_info`.
