

# Fix: BMS Connection Between Omanut OS and Omanut Automation

## Problem

The `bms-agent` function sends the API secret as `Authorization: Bearer <raw-hex-string>`. The Omanut OS bridge (`pkiajhllkihkuchbwrgz`) is a Supabase Edge Function. Supabase's gateway intercepts the `Authorization` header and tries to validate it as a JWT. A raw hex string is not a valid JWT, so the gateway returns "Unauthorized" before your bridge code even executes.

This affects both directions:
- **Outbound** (Automation → OS): `bms-agent` calls fail with "Unauthorized"
- **Inbound** (OS → Automation): `bms-callback` webhook may have the same issue if the OS side sends the secret in the Authorization header

## Fix (Two Parts)

### Part 1: On the Omanut OS side (the other Supabase project)

You need to do ONE of these on the `pkiajhllkihkuchbwrgz` project:

**Option A (Recommended):** Set `verify_jwt = false` on the `bms-api-bridge` function in that project's `supabase/config.toml`, then redeploy. Your bridge code should validate the secret itself (not rely on Supabase's JWT check).

**Option B:** Change the bridge to accept the secret via a custom header (e.g., `x-api-secret`) instead of `Authorization`, so it doesn't clash with Supabase's JWT validation.

### Part 2: On this project (Omanut Automation)

If you go with Option B above, update `bms-agent` and `bms-callback` to use the custom header:

**File: `supabase/functions/bms-agent/index.ts`**
- Change `"Authorization": \`Bearer ${connection.api_secret}\`` to `"x-api-secret": connection.api_secret`

**File: `supabase/functions/_shared/bms-connection.ts`**
- No changes needed (it just loads config)

**File: `supabase/functions/bms-callback/index.ts`**
- Update the inbound auth check to also accept `x-api-secret` header (for when Omanut OS sends callbacks)

### Part 3: Better error feedback in UI

**File: `src/components/admin/CompanySettingsPanel.tsx`**
- Show the actual error message from the BMS test instead of just a red X
- Display text like "Unauthorized — check API secret and bridge JWT settings" so you can debug faster

## Summary

The root cause is a Supabase gateway behavior: it rejects non-JWT `Authorization` headers when `verify_jwt` is `true` (the default). The simplest fix is to set `verify_jwt = false` on the Omanut OS bridge function and let the bridge validate the secret in its own code. No changes needed on this side if you go that route — only the OS project config needs updating.

