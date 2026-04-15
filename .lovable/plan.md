

## Aligning Omanut with BMS Tenant Linking

### Current State

On the Omanut side:
- `bms_connections` table stores `tenant_id` (the BMS tenant's ID) per company
- `bms-callback/index.ts` receives callbacks and resolves company via `tenant_id` lookup
- `bms-agent/index.ts` sends `tenant_id` in outgoing requests to the BMS bridge

The BMS project is adding `omanut_tenant_id` to their `bms_integration_configs` table and will include it in every callback payload. This creates a two-way link: BMS knows which Omanut company to target, and Omanut knows which BMS tenant to query.

### What Needs to Change on This Side

**Nothing breaks** — the current `tenant_id`-based lookup in `bms-callback` still works. But we should align to take advantage of the new field for better routing and validation.

### Changes

#### 1. Update `bms-callback/index.ts` — Accept `omanut_tenant_id` for routing

The BMS will now send `omanut_tenant_id` (which equals a `company_id` on this side) in the callback payload. Use it as a **primary routing key** when present, falling back to the existing `tenant_id` lookup.

```text
Incoming callback with omanut_tenant_id:
  → Direct match: company_id = omanut_tenant_id (skip DB lookup)
  → Still validate api_secret against bms_connections for that company

Incoming callback without omanut_tenant_id:
  → Existing tenant_id lookup (no change)
```

This is ~10 lines added to the authentication block (lines 34-56).

#### 2. Update `bms-agent/index.ts` — Send `omanut_tenant_id` in outgoing requests

When calling the BMS bridge, include the Omanut company_id as `omanut_tenant_id` in the payload so the BMS can store/verify the mapping.

```text
Current payload: { action, intent, tenant_id, ...params }
New payload:     { action, intent, tenant_id, omanut_tenant_id: companyId, ...params }
```

This is a 1-line addition in the `callBMS` function (line 28).

#### 3. Update `_shared/bms-connection.ts` — No schema change needed

The `bms_connections` table already has `tenant_id` (BMS side) and `company_id` (Omanut side). The `omanut_tenant_id` on the BMS side maps to `company_id` here — no new column needed on this side.

### Files to Change

| File | Change |
|------|--------|
| `supabase/functions/bms-callback/index.ts` | Accept `omanut_tenant_id` from payload as direct company routing key; validate secret against `bms_connections` for that company |
| `supabase/functions/bms-agent/index.ts` | Add `omanut_tenant_id: companyId` to outgoing BMS payloads |

No migration needed. This is a ~15-line change across 2 files.

