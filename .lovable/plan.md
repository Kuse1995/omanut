
Diagnosis

- I checked both the code and the key records.
- `oai_e02414bd` is a real admin key: `scope = admin`, `company_id = NULL`, active, and created by a user who still has the `admin` role.
- `oai_f237a9a4` is a company key pinned to Omanut Technologies.
- The current MCP server code already returns all companies for admin keys and only one company for company keys.
- So the problem is not the backend key scope. The problem is that OpenClaw has no reliable way to show which key/config is actually active, so it is guessing from the result and likely using a stale or mixed config.

Implementation

1. Add explicit auth visibility to the MCP server
   - Update `supabase/functions/mcp-server/index.ts`.
   - Make `list_my_companies` return safe debug info: `key_prefix`, `scope`, `default_company_id`, `active_company_id`, and `company_count`.
   - Add a small `who_am_i` / `debug_connection` MCP tool that reports the active key prefix and scope without exposing the full secret.

2. Make the OpenClaw skill package self-verifying
   - Update `src/components/admin/ApiKeysSection.tsx`.
   - Add setup instructions in `SKILL.md` telling OpenClaw to run the debug tool first before assuming the connection is correct.
   - Make it much clearer that per-row downloads are template ZIPs with `YOUR_API_KEY_HERE`, while the post-creation ZIP is the only one that contains the real key.

3. Add an in-app key test for admins
   - Add a “Test key” action in the admin keys UI.
   - It should verify and display: key prefix, detected scope, and expected company visibility.
   - This gives you a direct truth source from the app instead of relying on OpenClaw’s interpretation.

4. Tighten naming and install guidance
   - Keep admin packages clearly named `omanut-ai-admin`.
   - Keep company packages clearly named per company so configs don’t get mixed up.
   - Update install instructions to explicitly remove old Omanut MCP entries before restarting OpenClaw.

Verification

- Generate a fresh admin training key.
- Download the post-creation ZIP.
- Install it in OpenClaw.
- Run the new debug tool and confirm:
  - the prefix matches the key you just created
  - the scope is `admin`
- Run `list_my_companies` and confirm all 6 companies appear.
- Run `set_active_company` and verify company-specific tools operate on the selected company.

Technical details

- Files to update:
  - `supabase/functions/mcp-server/index.ts`
  - `src/components/admin/ApiKeysSection.tsx`
- No database migration is needed. The existing schema already supports admin-scoped keys correctly.