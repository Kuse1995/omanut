

# Multi-Tenant BMS Integration Plan

## Current State

- **`bms-agent`** uses a single hardcoded Finch BMS bridge URL and global `BMS_API_SECRET`
- **`bms-callback`** authenticates all incoming webhooks against one global `BMS_API_SECRET`
- **`whatsapp-messages`** and **`boss-chat`** call `bms-agent` passing `company_id` in params
- `bms-agent` does NOT use `company_id` to resolve credentials — it just forwards it to the bridge

## Design

Two BMS types coexist:
- **Finch Investments** → single-tenant BMS (hardcoded bridge URL + global secret) — only Finch's company connects here
- **All other companies** → multi-tenant BMS (different bridge URL, each company has a `tenant_id`)

## Implementation

### 1. Database: `bms_connections` table

```sql
CREATE TABLE public.bms_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  bms_type text NOT NULL DEFAULT 'multi_tenant',  -- 'single_tenant' or 'multi_tenant'
  bridge_url text NOT NULL,
  api_secret text NOT NULL,
  tenant_id text,  -- required for multi_tenant type
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

RLS: company members can SELECT, managers can INSERT/UPDATE, owners can DELETE, platform admins full access.

### 2. Shared helper: `_shared/bms-connection.ts`

Exports `loadBmsConnection(supabase, companyId)`:
- Queries `bms_connections` for the company
- If no record found, falls back to global env vars (Finch backward compat)
- Returns `{ bridge_url, api_secret, bms_type, tenant_id }`

### 3. Update `bms-agent/index.ts`

- Accept `company_id` from `params` (already passed by callers)
- Call `loadBmsConnection()` to get the right bridge URL and secret
- For `multi_tenant` type: include `tenant_id` in every request payload to the bridge
- For `single_tenant` (Finch): works exactly as today

### 4. Update `bms-callback/index.ts`

- Extract `tenant_id` from the incoming payload
- Look up the company via `bms_connections` WHERE `tenant_id` matches
- Validate the `Authorization` header against that connection's `api_secret`
- Fall back to global `BMS_API_SECRET` if no `tenant_id` (Finch backward compat)
- Use resolved `company_id` for boss notifications

### 5. Admin UI: BMS settings in `CompanySettingsPanel.tsx`

Add a "BMS Integration" card:
- Dropdown: BMS type (single-tenant / multi-tenant) — single-tenant locked to Finch only
- Input: Bridge URL
- Input: API Secret (masked)
- Input: Tenant ID (shown for multi-tenant)
- Toggle: Active/Inactive
- "Test Connection" button (calls `bms-agent` with `list_products`)

### 6. No new secrets needed

Per-company secrets are stored in `bms_connections` table, not as global env secrets. The existing global `BMS_API_SECRET` remains for Finch backward compatibility.

### Changes Summary

| Component | Change |
|-----------|--------|
| Database | New `bms_connections` table with RLS |
| `_shared/bms-connection.ts` | New shared credential loader |
| `bms-agent` | Load per-company BMS config, route to correct bridge |
| `bms-callback` | Resolve company by `tenant_id`, per-connection auth |
| `CompanySettingsPanel.tsx` | BMS settings card |

### Backward Compatibility

Finch continues working without any `bms_connections` record — the global env vars serve as fallback. New companies must have a `bms_connections` record pointing to the multi-tenant BMS.

