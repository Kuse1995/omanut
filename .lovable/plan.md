

# Fix: BMS "Not Configured" Error in Boss Chat

## Root Cause

**Line 1617-1621 in `boss-chat/index.ts`** checks for TWO env vars before allowing any BMS tool call:

```typescript
const BMS_API_URL = Deno.env.get('BMS_API_URL');
const BMS_API_SECRET = Deno.env.get('BMS_API_SECRET');
if (!BMS_API_URL || !BMS_API_SECRET) {
  result = { success: false, message: '❌ BMS integration not configured.' };
  break;
}
```

`BMS_API_URL` does not exist in your secrets — and it doesn't need to. The actual BMS call on line 1640 goes through `bms-agent`, which resolves the bridge URL internally via `bms-connection.ts`. The `BMS_API_URL` check is a stale guard from an older direct-call pattern.

`BMS_API_SECRET` exists and is correctly used by `bms-agent` as a fallback. So the only blocker is the phantom `BMS_API_URL` check.

## Fix

**`supabase/functions/boss-chat/index.ts`** — Remove the `BMS_API_URL` requirement. Only check `BMS_API_SECRET` (which the bms-agent fallback needs), or better yet, remove the guard entirely since `bms-agent` handles its own connection resolution and returns a clear error if unconfigured.

```typescript
// Remove lines 1617-1622 (the BMS_API_URL/BMS_API_SECRET guard)
// bms-agent already handles missing config and returns a proper error
```

The `bms-agent` already returns `{ success: false, error: "No BMS connection configured" }` when no connection exists, so the boss-chat code will naturally surface that error to the AI. No duplicate guard needed.

## Impact

This single change fixes `check_stock`, `record_sale`, `sales_report`, and all 18 other BMS tools in boss-chat. The same tools work fine in `whatsapp-messages` because that function calls the Finch bridge directly with `BMS_API_SECRET` (no `BMS_API_URL` check).

