

## Fix: GreenGrid sees Finch's LifeStraw catalog (cross-tenant leak)

### Correction on yesterday's mistake

I incorrectly described the Finch BMS as "ANZ's BMS". They are separate:

| Company | BMS bridge | Tenant |
|---|---|---|
| ANZ General Dealers | `pkiajhllkihkuchbwrgz` | multi-tenant `d458e4d7…` |
| Finch Investments | `hnyzymyfirumjclqheit` | single-tenant (no tenant_id) |
| Omanut | `pkiajhllkihkuchbwrgz` | multi-tenant `84f8d51d…` |
| GreenGrid, North Park, E-Library, Art of Intelligence | **none** | — |

LifeStraw is exclusive to **Finch**. GreenGrid seeing it = Finch leaking, not ANZ.

### Root cause

GreenGrid has no row in `bms_connections`. The `CompanyMedia` page calls `bms-agent` with `action: 'list_products', params: { company_id: <GreenGrid> }`. The function still returns Finch's catalog, which means one of these is true:

1. `bms-agent` has another code path (besides `loadBmsConnection`) that falls back to the legacy `BMS_API_SECRET` / `FINCH_BRIDGE_URL` env vars when no per-company connection exists — and yesterday's edit didn't cover it.
2. Or `loadBmsConnection` for GreenGrid is incorrectly resolving to Finch's row (e.g. a stale cache, or a query returning the wrong row).

Once I open `supabase/functions/bms-agent/index.ts` in default mode I'll confirm which it is — but the fix shape is the same either way.

### Fix

**1. Harden `bms-agent/index.ts`**
- Remove every remaining reference to `BMS_API_SECRET`, `FINCH_BRIDGE_URL`, or any default tenant inside the function.
- At the top of every action handler (`list_products`, `check_stock`, `search_products`, `record_sale`, `generate_payment_link`, etc.), require a non-null result from `loadBmsConnection(supabase, company_id)`. If null → return `{ success: true, data: [], no_connection: true }` for read intents and `{ success: false, code: "NO_BMS_CONNECTION" }` for write intents. No fallback, ever.
- Add a defensive assertion: after fetching products, verify the returned bridge_url matches `connection.bridge_url`. If not, log a `[SECURITY]` warning and return empty.

**2. Invalidate the in-memory cache**
The 5-minute cache in `_shared/bms-connection.ts` may still hold a stale entry from before yesterday's deploy. Force a cold start by either bumping a version constant in that file or adding `invalidateBmsConnectionCache()` on module load. Cleanest: change the cache key to include a function-deploy timestamp so a redeploy auto-invalidates.

**3. Frontend defense in depth (`src/components/CompanyMedia.tsx`)**
When `bms-agent` returns `no_connection: true` OR an empty array, render the existing "No BMS connection found" empty state and do **not** populate the dropdown. (Already does this for empty array — just need to make sure `no_connection` is treated the same.)

**4. Audit log**
Insert a row into `cross_tenant_audit` whenever `bms-agent` rejects a request because the requesting company has no connection, so any future leak is immediately visible.

### Validation

1. Open GreenGrid → Company Media → Link to BMS Product dropdown should show "No BMS connection found. Connect to a BMS to link products to media."
2. Open North Park / E-Library / Art of Intelligence → same empty state.
3. Open Finch → still shows Finch's LifeStraw catalog (unchanged).
4. Open ANZ → shows ANZ's catalog from the multi-tenant bridge (unchanged).
5. Open Omanut → shows Omanut's catalog from the multi-tenant bridge (unchanged).
6. Tail edge function logs while clicking through each company → no `[BMS-CONNECTION] fallback` lines, no `FINCH_BRIDGE_URL` references hit.

### Files

- `supabase/functions/bms-agent/index.ts` — strip all remaining default/env-var fallbacks; add per-action guard; add audit log on reject.
- `supabase/functions/_shared/bms-connection.ts` — cache invalidation on deploy.
- `src/components/CompanyMedia.tsx` — handle `no_connection: true` flag explicitly.
- Redeploy `bms-agent`.

No DB schema changes.

