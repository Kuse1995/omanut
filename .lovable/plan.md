# Fix: OpenClaw never sees inbound WhatsApp messages

## Root cause
`whatsapp-messages/index.ts` (the OPENCLAW-PRIMARY branch around line 6739) still uses the deprecated v2 push path — it POSTs to `openclaw-dispatch` (which hits the offline tunnel) and locks the conversation with `human_takeover=true, takeover_by='openclaw'`. As a result:
- No row is ever inserted into `inbound_events`, so the OpenClaw pull loop has nothing to claim.
- Omanut's in-house AI is blocked by the takeover flag, so the 8-second failover never engages either.
- Net effect: customer sends "Hi" → silence.

## Steps

1. **Rewrite the OPENCLAW-PRIMARY branch in `whatsapp-messages/index.ts`**
   - Remove the `openclaw-dispatch` invoke and the `human_takeover=true` write.
   - Insert one row into `inbound_events` with:
     - `company_id`, `conversation_id`
     - `channel='whatsapp'`, `source='twilio_whatsapp'`
     - `external_id = MessageSid` (dedup key)
     - `status='pending'`, `next_attempt_at = now()`
     - `payload` = the normalized Twilio payload (From, Body, MediaUrls, ProfileName, etc.)
   - Return 200 to Twilio immediately (no waiting on OpenClaw).

2. **Mirror the same change in `meta-webhook`** for DM + comment inbounds, so the queue is the single source of truth across channels.

3. **Confirm the failover worker is wired**
   - Verify the cron / worker that scans `inbound_events` where `status='pending' AND created_at < now() - interval '8 seconds'` and re-routes to the in-house Omanut swarm exists and is scheduled.
   - If missing, add it as a small edge function + 1-minute cron.

4. **Verify OpenClaw is actually pulling**
   - The local OpenClaw process must be calling `GET /functions/v1/openclaw-pull?max=10&wait=25` (or SSE / Realtime) and then `claim_inbound_event` RPC with `Authorization: Bearer <OPENCLAW_GATEWAY_TOKEN>`.
   - Heartbeat alone (MCP traffic) does not prove the pull loop is running. Add this check to `/admin/sandbox-console` — "last pull at" timestamp per company.

5. **End-to-end test**
   - Send "Hi" to Omanut Technologies WhatsApp.
   - Expect: new `inbound_events` row appears within 1s. Within 8s, either `status='sent'` + `claimed_by='openclaw'` (OpenClaw answered) OR the worker fires and Omanut's AI replies (failover proven).
   - Watch `/admin/observability` for the claim/failover counters.

6. **Deprecate the push path** (`openclaw-dispatch` function + v2 branch code) after one clean day of v3 traffic.

## Files touched
- `supabase/functions/whatsapp-messages/index.ts` — rewrite OPENCLAW-PRIMARY branch
- `supabase/functions/meta-webhook/index.ts` — same pattern for DM/comment inbounds
- `supabase/functions/openclaw-failover-worker/index.ts` *(new, if not already present)* + cron
- `src/pages/admin/SandboxConsole.tsx` — add "last pull at" indicator

## Out of scope
- Changing OpenClaw client code on your machine (we assume it pulls; we'll verify in Step 4).
- Touching other companies' configs.
