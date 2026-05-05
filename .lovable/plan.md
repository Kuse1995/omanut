# Fix: OpenClaw can't see Omanut knowledge in Drafter Mode

## Root cause

The `openclaw-dispatch` payload sends almost nothing about the company:

```json
"company_brief": { "business_type": "school", "sales_mode": null }
```

It does NOT include `quick_reference_info` (the full KB where North Park's tuition fees live), nor BMS data, nor a way to look it up live. So when a parent asks "How much is tuition?", OpenClaw has no source material and answers blank.

Meanwhile our internal AI gets all of this stitched in by `whatsapp-messages` before calling the model. Drafter Mode bypassed that step.

## Fix — two layers

### 1. Inline the knowledge base in every dispatch (fast win)

Update `openclaw-dispatch/index.ts` so the payload includes a real `company_context` block:

- `quick_reference_info` (truncated to ~8k chars) — the curated KB
- `payment_instructions`, `payment_number_*`, `currency_prefix`
- `services`, `service_locations`, `hours`, `branches`
- `business_type`, `sales_mode`, `voice_style`
- BMS snapshot (when a `bms_connections` row exists for the company): call `bms-training-sync` once and cache the `formatted_text` on `bms_connections.last_kb_text` / `last_bms_sync_at` (already stamped). Reuse the cached text if synced <15 min ago, else re-sync. Send as `bms_snapshot`.
- `kb_version_hash` so OpenClaw can cache on its side.

Add to `reply_instructions`: "Answer ONLY from `company_context` and `bms_snapshot`. If the answer isn't there, call the lookup endpoint or return `action: 'handoff'`."

### 2. Live lookup endpoint (for fresh stock / things not in KB)

New edge function `openclaw-lookup` (HMAC-signed, same secret):

POST body:
```json
{ "company_id": "...", "intent": "check_stock" | "list_products" | "search_kb" | "get_pricing", "query": "tuition grade 3" }
```

- `search_kb` → simple ILIKE / vector search across `quick_reference_info` + `company_documents.parsed_content` (we already have `match_documents` RPC).
- `check_stock` / `list_products` / `get_sales_summary` → proxy to the company's BMS bridge via `_shared/bms-connection.ts` (same pattern as `bms-training-sync`).

The dispatch payload exposes this URL as `lookup_url` so the agent can fetch on demand instead of us shipping the entire BMS catalog every message.

### 3. Surface in OPENCLAW_INTEGRATION.md

Document the new `company_context`, `bms_snapshot`, and `lookup_url` fields with an example call and the HMAC scheme (already used for `reply_to_url`).

## Technical details

**Files to edit / create**
- `supabase/functions/openclaw-dispatch/index.ts` — add `company_context`, `bms_snapshot`, `lookup_url`, beef up `reply_instructions`
- `supabase/functions/openclaw-lookup/index.ts` — NEW; HMAC-verified; routes to KB search or BMS bridge
- `supabase/functions/_shared/bms-connection.ts` — already has loader, reuse
- `OPENCLAW_INTEGRATION.md` — document new fields

**Schema**
- Add `bms_connections.last_kb_text text` (cache) — single migration. No other schema changes.

**Caching strategy**
- BMS snapshot: refresh every 15 min per company on dispatch (cheap — most calls hit cache).
- KB text: read live from `companies.quick_reference_info` (already in DB, no extra fetch).

**Why not push everything to OpenClaw once?**
The agent has no per-company memory we control, and KB / BMS change. Re-sending on each event keeps the agent stateless and avoids stale answers like the tuition-fee miss.

## Validation

After deploy: send "how much is tuition for grade 3?" to North Park's WhatsApp. Expect the dispatched payload (visible in `openclaw_events.payload`) to contain the tuition section, and the drafted reply to quote the actual K-amount from `quick_reference_info`.
