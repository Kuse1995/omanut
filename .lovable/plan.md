

## Fix BMS Training Sync Authorization

### Problem
The `bms-training-sync` edge function sends the API secret as `x-api-secret` header only, but the BMS bridge requires `Authorization: Bearer <api_secret>`. The `bms-agent` function already sends both headers correctly — `bms-training-sync` just needs the same fix.

### Changes

| File | Change |
|------|--------|
| `supabase/functions/bms-training-sync/index.ts` | Add `"Authorization": \`Bearer ${connection.api_secret}\`` to the headers in the `callBMS` function (line 33), matching the pattern used in `bms-agent/index.ts` |

One line added. Deploy the function afterward.

### Result
"Sync from BMS" will authenticate correctly against the BMS bridge, pulling products, stock alerts, and sales data successfully.

