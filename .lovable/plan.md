

## Fix: admin can't manually send messages (401 Unauthorized)

### Root cause (confirmed)

From the cross-tenant audit log, your manual send was **blocked with reason `user_not_in_company`**:

- Admin user `abkanyanta@gmail.com` → has global `admin` role ✓
- Admin is NOT a row in `company_users` for the target tenant (Omanut Technologies) ✗
- `send-whatsapp-message` requires JWT sender to be in `company_users` for the conversation's company → returns **401**

The function was hardened against cross-tenant leaks but never carved out an exception for platform admins. Result: admins can only message tenants they happen to be enrolled in, which defeats the whole admin console.

### Fix

In `supabase/functions/send-whatsapp-message/index.ts`, the JWT authorization block (lines 147-163) currently only checks `company_users`. Add an admin-role bypass before the rejection:

```ts
if (userId && !isServiceRole) {
  // Platform admins can send into any tenant's conversation
  const { data: adminRole } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'admin')
    .maybeSingle();

  if (!adminRole) {
    // Non-admin users must be enrolled in the company
    const { data: accessData } = await supabase
      .from('company_users')
      .select('id')
      .eq('user_id', userId)
      .eq('company_id', conversation.company_id)
      .maybeSingle();

    if (!accessData) {
      await auditDecision('blocked', 'user_not_in_company', conversation.company_id, conversation.phone);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } else {
    // Audit admin override for traceability
    await auditDecision('allowed', 'admin_role_override', conversation.company_id, conversation.phone, { admin_user_id: userId });
  }
}
```

### Why this is safe
- Only users with the `admin` role in `user_roles` (already the source of truth for the admin portal at `/admin/login`) bypass the company-membership check.
- Every admin send is still recorded in `cross_tenant_audit` with reason `admin_role_override`, so the audit trail stays intact.
- Service-role callers (MCP, internal cron) keep their existing path. Non-admin company users still must be in `company_users`.

### Files

- **`supabase/functions/send-whatsapp-message/index.ts`** — add admin-role bypass in the JWT authz block (~lines 147-163). Redeploy.

No DB migration, no schema changes, no UI changes.

### Validation

1. As admin (`abkanyanta@gmail.com`), open any tenant's conversation in the admin console → type "hello" → send. Expect 200 + message delivered to the customer; audit row shows `decision: allowed, reason: admin_role_override`.
2. As a regular company user (non-admin) sending into their own company → still works (existing path).
3. As a regular user trying to send into a company they don't belong to → still blocked with `user_not_in_company` (security preserved).

