

# Plan: Improve Demo Handoff & First-Contact Greeting

## Problems Identified

1. **Customer name not available in demo-session**: The `whatsapp-messages` function extracts `ProfileName` from Twilio but does NOT pass it to `demo-session`. The JSON body only includes `from`, `body`, `company_id`, `boss_phone`.

2. **Handoff notification shows the AI's customer reply instead of an assessment**: The current code sends `cleanResponse` (the reply meant for the customer) as the "AI assessment", not an actual summary of the situation.

3. **No personalized first-contact greeting**: The AI has no instruction to greet new customers by their WhatsApp name and confirm how they'd like to be addressed.

---

## Changes

### 1. `supabase/functions/whatsapp-messages/index.ts` (~line 3293)

Pass `ProfileName` in the JSON body sent to `demo-session`:

```text
body: JSON.stringify({
  from: From,
  body: Body,
  company_id: company.id,
  boss_phone: company.boss_phone,
  profile_name: ProfileName,   // <-- ADD THIS
}),
```

### 2. `supabase/functions/demo-session/index.ts`

**a) Accept `profile_name` from request** (~line 19):
```text
const { from, body, company_id, boss_phone, profile_name } = await req.json();
```

**b) Store the name in the conversation** (~line 228-239): Use `profile_name` instead of the generic "Demo (company)" label for `customer_name`. Also backfill existing conversations missing a name.

**c) Update the AI system prompt** (~line 193-212): Add a first-contact instruction:

```text
FIRST CONTACT GREETING:
- The customer's WhatsApp name is: "${profile_name || 'Unknown'}"
- If this is the first message in the conversation (no prior history), warmly greet them, mention you noticed their name is [name], and ask if that's what they prefer to be called — then naturally transition into how you can help.
- If you've already greeted them, do NOT repeat the name confirmation. Just continue the conversation naturally.
```

**d) Fix the handoff notification** (~line 289-304): Instead of sending the AI's customer-facing reply as the "assessment", generate a brief internal summary. The handoff message becomes:

```text
const handoffMessage =
  `🔔 *[DEMO HANDOFF]*\n\n` +
  `👤 Customer: ${profile_name || 'Unknown'} (${senderPhone})\n` +
  `🏢 Demo company: ${activeSession.demo_company_name}\n` +
  `💬 Customer said: "${messageText.substring(0, 200)}"\n\n` +
  `📋 Conversation summary: The customer has been chatting with the AI ` +
  `receptionist for ${activeSession.demo_company_name}. ` +
  `They are requesting to speak with a human representative.\n\n` +
  `🤖 Last AI response: ${cleanResponse.substring(0, 200)}`;
```

This separates the customer's actual message from the AI's response and includes the customer's name prominently.

---

## Technical Details

| File | Change |
|------|--------|
| `supabase/functions/whatsapp-messages/index.ts` | Add `profile_name: ProfileName` to demo-session call body |
| `supabase/functions/demo-session/index.ts` | Accept `profile_name`, add first-contact greeting prompt, fix handoff message format, store real customer name |

### First-Contact Flow

```text
Customer sends "Hi" →
  AI checks: no conversation history →
  AI responds: "Hello! Welcome to [Company]. I see your name here is [ProfileName] — 
  should I call you that, or do you prefer something else? 
  I'm here to help with anything you need!"
```

### Handoff Notification to Boss

```text
🔔 [DEMO HANDOFF]

👤 Customer: Sarah (260971234567)
🏢 Demo company: Hilton Lusaka
💬 Customer said: "I need to speak to a manager about my booking"

📋 Conversation summary: Customer chatted with AI receptionist.
They are requesting human assistance.

🤖 Last AI response: "I understand you'd like to speak with someone..."
```

