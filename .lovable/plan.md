

# Fix: Manual Message Sending + OpenClaw Follow-Up Messages

## Problem 1: Manual messages fail from admin panel
The `send-whatsapp-message` edge function sends to Twilio with `conversation.phone` as the `To` field (line 116), but WhatsApp numbers need the `whatsapp:` prefix. If the stored phone number doesn't already have `whatsapp:`, Twilio rejects it silently. Additionally, the CORS headers are missing some required headers that the Supabase client sends.

## Problem 2: OpenClaw can't send follow-up messages
The MCP server's `send_message` tool passes `phone` and `company_id` to the `send-whatsapp-message` function, but that function only accepts `conversationId` — it ignores `phone` and `company_id`. The function also requires a valid user JWT for authorization, but the MCP server authenticates via API key, not user JWT. This means every MCP call gets a 401 Unauthorized.

## Fix

### 1. Update `send-whatsapp-message/index.ts`

- **Fix CORS headers**: Add missing headers (`x-supabase-client-platform`, etc.)
- **Fix WhatsApp `To` prefix**: Normalize customer phone to include `whatsapp:` prefix before sending to Twilio (same pattern as the `From` number)
- **Support dual auth**: Allow either JWT auth (admin panel) OR service-role key auth with `company_id` param (for MCP/internal calls)
- **Support phone-based lookup**: When `conversationId` is not provided but `phone` + `company_id` are, look up or create the conversation by phone number

### 2. Update `mcp-server/index.ts` — `send_message` tool

- Add `conversation_id` as an optional parameter so OpenClaw can target a specific conversation
- Pass `company_id` in the request body (already done)
- Use service-role key auth (already done) — the `send-whatsapp-message` function will accept it after the fix above

## Files to Edit

| File | Change |
|------|--------|
| `supabase/functions/send-whatsapp-message/index.ts` | Fix CORS, add `whatsapp:` prefix to `To`, support service-role auth + phone lookup |
| `supabase/functions/mcp-server/index.ts` | Add `conversation_id` param to `send_message` tool |

Both edge functions will be redeployed automatically.

