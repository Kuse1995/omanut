

## The leak — three real vulnerabilities

I traced this end to end. Here's what I found in the database and code:

### Leak #1 — Inbound digit-fallback collides across companies (CRITICAL)

`supabase/functions/whatsapp-messages/index.ts` lines 5256–5294. When Twilio webhooks an inbound message, we look up the company by the `To` number with three fallbacks. Fallback #2 is the smoking gun:

```ts
.ilike('whatsapp_number', `%${lastDigits}%`).limit(1).maybeSingle()
```

This matches **substrings of phone numbers across all companies** and returns the first hit. With 6 companies, two share `260967254226` (E Library `twilio_number` and ANZ's `boss_phone` — but boss isn't searched here), and any 10-digit substring overlap can pick the wrong row. Worse, `maybeSingle()` with `limit(1)` returns whichever row Postgres scans first — non-deterministic.

The DB confirms the symptom: `whatsapp:+260972064502` (Omanut's owner phone) appears as the **customer phone on 6 different companies' conversations**, including ANZ. When Abraham messages from his personal number, an inbound to Omanut's `whatsapp:+260768737233` could route to ANZ if the fallback misfires.

### Leak #2 — `send-whatsapp-message` trusts the caller's `company_id` blindly

`supabase/functions/send-whatsapp-message/index.ts` line 80–123. When called with `phone + company_id` (the MCP/internal path), it:
1. Searches conversations scoped to `company_id` ✅
2. **If none found, creates a brand new conversation under that `company_id` with the customer phone** ❌

Combined with the MCP `send_message` tool (`mcp-server/index.ts` line 448–471) which passes the active `companyId` straight through with **no check that the phone actually belongs to that tenant**, an admin-scope OpenClaw key with the wrong active company set will:
- Create an ANZ conversation row for an Omanut customer
- Send a Twilio WhatsApp message FROM ANZ's number TO that customer
- Insert an `assistant` message under ANZ

This matches what's in the DB right now: ANZ conversations with `customer_name = "OMANUT TECHNOLOGIES LIMITED"` and `phone = whatsapp:+260972064502`.

### Leak #3 — No customer↔company binding check anywhere

There's no table/check that says "this customer phone has interacted with this company before." Any code path that resolves a company by ambiguous lookup (digit substring, active session, MCP param) can legitimately attach the wrong company to a customer phone.

## Plan — 4 fixes, ordered by blast radius

### Fix 1 — Kill the unsafe digit fallback (5 min, blocks Leak #1)

In `whatsapp-messages/index.ts` lines 5281–5294: replace the `ilike '%digits%'` fallback with an exact match on the last 10 digits using a precomputed condition. Use `or('whatsapp_number.eq.+<digits>,whatsapp_number.eq.whatsapp:+<digits>')`. If still no match, fail closed — return "number not configured" instead of guessing.

Also add a hard guard: if more than one company matches the lookup, **refuse and log a security event** (do not pick "the first one").

### Fix 2 — Lock down `send-whatsapp-message` (15 min, blocks Leak #2)

In `send-whatsapp-message/index.ts`:
- **Never auto-create a conversation** for a phone we've never seen under that company. If `phone + company_id` doesn't match an existing conversation, reject with `403 NO_CUSTOMER_BINDING` and surface a clear error to the caller (OpenClaw or admin UI).
- When `conversationId` is provided, verify `conversation.company_id === company_id` (caller-asserted). Reject on mismatch.
- Log every send to a new `cross_tenant_audit` table: `{caller_scope, asserted_company_id, resolved_company_id, customer_phone, decision}`.

### Fix 3 — Tighten the MCP `send_message` tool (10 min, blocks Leak #2 at source)

In `mcp-server/index.ts` lines 448–471:
- Before calling `send-whatsapp-message`, verify the `(phone, companyId)` pair exists in `conversations`. If not, return a structured error: `"This customer has no conversation with <company>. Cannot send unsolicited message."`
- Keep `requireOpenClawEnabled(companyId)` (already there).
- Log the attempt to the new audit table regardless of outcome.

### Fix 4 — Clean up the existing leaked rows (one-off SQL, 5 min)

The DB currently has 5 ANZ/Finch/Art-of-Intelligence/E Library/North Park conversations falsely attributed to Abraham's personal phone. Migration to:
1. Identify rows where `customer_name = 'OMANUT TECHNOLOGIES LIMITED'` on **non-Omanut** companies.
2. Soft-delete (mark `status='archived', metadata.archive_reason='cross_tenant_leak_cleanup'`) so we keep the audit trail but they don't surface in inboxes.
3. Surface the count in the security audit log.

## Files

- `supabase/functions/whatsapp-messages/index.ts` — Fix 1 (lines 5281–5294)
- `supabase/functions/send-whatsapp-message/index.ts` — Fix 2 (lines 80–123 + new conversation_id validator)
- `supabase/functions/mcp-server/index.ts` — Fix 3 (lines 448–471)
- New migration — `cross_tenant_audit` table + cleanup of leaked rows

No new secrets. No frontend changes. After this, no code path can attach a customer phone to a company it hasn't legitimately interacted with, and digit collisions can't silently route inbound messages to the wrong tenant.

## Verification

1. Re-run inbound resolver test: send to `whatsapp:+260768737233` → must resolve to Omanut, never ANZ.
2. Call MCP `send_message` with admin scope, `active_company=ANZ`, `phone=+260771375389` (an Omanut customer) → must return `NO_CUSTOMER_BINDING`.
3. Query `cross_tenant_audit` after each test — entries present.
4. Confirm leaked ANZ conversations are archived (not visible in `/conversations` for ANZ).
5. Re-test ANZ's normal customers (`+260972064502` test sender → ANZ) — flow still works because the conversation already exists.

