

# Diagnosis: WhatsApp Messages Not Responding

## Root Cause
The `whatsapp-messages` edge function is **deployed, working, and the Gemini API integration is functional**. I confirmed this by sending a simulated Twilio POST — it processed successfully, identified the sender, and routed to the correct handler.

**The problem is that Twilio is not delivering incoming WhatsApp messages to your webhook URL.** Zero real customer messages appear in the function logs.

## Evidence
1. Simulated POST to E Library's number returned `200 OK` with empty TwiML (background processing started)
2. Logs confirmed: message parsed, boss phone matched, routed to `boss-chat` correctly
3. No real Twilio webhook deliveries visible in any recent logs
4. The Twilio error 93101 you shared is about Event Streams (analytics), not message delivery

## What You Need to Verify in Twilio Console

### For Finch Investments (+260766195857)
- Go to **Twilio Console → Messaging → Senders → WhatsApp Senders** (or Sandbox if using sandbox)
- Set "When a message comes in" webhook URL to:
  ```
  https://dzheddvoiauevcayifev.supabase.co/functions/v1/whatsapp-messages
  ```
- Method: **POST**

### For E Library (+14647686485)
- Same URL:
  ```
  https://dzheddvoiauevcayifev.supabase.co/functions/v1/whatsapp-messages
  ```
- Method: **POST**

Note: The `?company_id=` query parameter is **not required** — the function looks up the company by the `To` phone number automatically. But adding it won't hurt.

### Common Twilio Webhook Issues to Check
1. **Sandbox expiry** — If using Twilio Sandbox, the session expires after 72 hours of inactivity. Users must re-join by sending the sandbox keyword.
2. **Number not approved** — If using a production WhatsApp number, it must be approved in Meta Business Manager.
3. **Webhook URL typo** — Ensure there are no extra spaces or characters in the URL.
4. **Twilio Debugger** — Check **Monitor → Errors** for any 11200 (HTTP retrieval failure) or 11205 (HTTP connection failure) errors, which indicate Twilio cannot reach your webhook.

## No Code Changes Required
The function code and Gemini API integration are working correctly. This is purely a Twilio configuration issue.

