

## Remove Redundant Tenant ID Entry — Auto-Handshake Between BMS and Omanut

### Problem
Both sides are asking admins to manually copy-paste IDs that each system already knows:
- **Omanut side**: Asks for the BMS "Tenant ID" (manual entry)
- **BMS side**: Asks for the "Omanut Tenant ID" (manual entry)

This is redundant. The Omanut `company_id` IS the `omanut_tenant_id` the BMS needs, and the BMS already knows its own `tenant_id`.

### Solution: Auto-Handshake on "Connect"

When the admin clicks "Connect to BMS" on the Omanut side:
1. Auto-generate the API secret (already done)
2. Send a **registration handshake** to the BMS bridge that includes `omanut_tenant_id: companyId` and the shared secret
3. The BMS responds with its own `tenant_id`
4. Both sides are now linked — no manual ID entry needed

### Changes

| File | Change |
|------|--------|
| `src/components/admin/CompanySettingsPanel.tsx` | Remove the manual "Tenant ID" input field. On save (for new connections), call a handshake endpoint on the BMS bridge that sends `{ intent: "register_omanut_link", omanut_tenant_id: companyId, api_secret: secret }`. If the BMS returns a `tenant_id`, store it automatically. For existing connections, keep showing the tenant ID as read-only info. |
| `supabase/functions/bms-agent/index.ts` | Add a `register_omanut_link` intent that sends the company's ID and secret to the BMS bridge, expecting `tenant_id` back in the response. |

### Fallback
If the BMS bridge doesn't support the handshake yet (returns error/404), fall back to the current behavior: show the Tenant ID field for manual entry, with a note saying "Ask your BMS admin for this ID." This way it works today and improves as the BMS side adds the handshake endpoint.

### Result
- Admin clicks "Connect to BMS" → secret auto-generated, IDs exchanged automatically
- No copy-pasting tenant IDs between dashboards
- Backward compatible with BMS instances that haven't added the handshake endpoint yet

