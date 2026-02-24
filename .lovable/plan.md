

# Plan: Auto-Detect Customer Names from WhatsApp Profile

## What's Happening Now

Twilio already sends the customer's WhatsApp display name in every webhook as `ProfileName`. Your code already reads it for boss messages (line 3814), but **never uses it** for customer conversations. That's why `customer_name` is often empty or null.

## What Changes

Extract `ProfileName` from the Twilio form data and use it to:
1. Set `customer_name` on the conversation when creating a new one
2. Update `customer_name` on existing conversations if it's currently empty (in case the customer changed their WhatsApp name or it wasn't captured before)
3. Pass the name to `processAIResponse` so the AI can greet the customer by name

## Technical Details

### File: `supabase/functions/whatsapp-messages/index.ts`

**1. Extract ProfileName (after line 3170)**

Add:
```typescript
const ProfileName = formData.get('ProfileName') as string || '';
```

**2. Use ProfileName when creating new conversation (around line 3957-3966)**

Update the conversation insert to include `customer_name`:
```typescript
const { data: newConv, error: createError } = await supabase
  .from('conversations')
  .insert({
    company_id: company.id,
    phone: From,
    status: 'active',
    customer_name: ProfileName || null,
    transcript: `CUSTOMER PHONE: ${customerPhone}\nCUSTOMER NAME: ${ProfileName || 'Unknown'}\n`
  })
  .select()
  .single();
```

**3. Update existing conversations missing a name (after the existing conversation branch, around line 3974-3976)**

```typescript
// Update customer_name if missing but ProfileName is available
if (conversation && !conversation.customer_name && ProfileName) {
  await supabase
    .from('conversations')
    .update({ customer_name: ProfileName })
    .eq('id', conversation.id);
  conversation.customer_name = ProfileName;
}
```

**4. Include name in AI context**

The `processAIResponse` function already has access to the conversation data. Once `customer_name` is set on the conversation record, the AI system prompt (which reads `conversation.customer_name`) will naturally use it for personalized greetings.

### No database changes needed
The `conversations` table already has a `customer_name` column -- it's just not being populated from the WhatsApp profile data.

### Result
- Every new customer automatically gets their WhatsApp name saved
- Existing customers with missing names get updated on their next message
- The AI can greet customers by name: "Hi Sarah, how can I help you today?"
- Agent Workspace shows real names instead of just phone numbers
- All tickets, queue items, and handoff notifications use the real name

