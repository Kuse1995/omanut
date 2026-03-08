

# Fix AI Repeating Greetings on Every Message

## Problem
The AI keeps repeating greeting text because conversation history is passed as a single `user`-role message containing raw transcript text. The model doesn't recognize which parts are its own previous replies, so it "resets" and greets again with each new message.

## Root Cause
In `supabase/functions/whatsapp-messages/index.ts` (line ~1437-1447):

```text
// Current: entire transcript dumped as one "user" message
messages = [
  { role: 'system', content: instructions },
  { role: 'user', content: 'Previous conversation:\nCustomer: hi\nAssistant: Welcome to Finch!...' },  // ← AI can't tell this is its own output
  { role: 'user', content: 'send me the direct purchase link' }
]
```

The model sees everything as user input, loses context of what it already said, and re-greets.

## Fix

### `supabase/functions/whatsapp-messages/index.ts`

**Change 1** — Replace the transcript-as-single-message approach (lines ~1437-1453) with properly structured `user`/`assistant` alternating messages parsed from the transcript:

```typescript
// Parse transcript into proper user/assistant messages
const transcriptLines = conversation.transcript.split('\n').filter((line: string) => line.trim());
const parsedMessages: Array<{ role: string; content: string }> = [];

for (const line of transcriptLines) {
  const customerMatch = line.match(/^Customer:\s*(.+)/i);
  const assistantMatch = line.match(/^Assistant:\s*(.+)/i);
  if (customerMatch) {
    parsedMessages.push({ role: 'user', content: customerMatch[1] });
  } else if (assistantMatch) {
    parsedMessages.push({ role: 'assistant', content: assistantMatch[1] });
  }
}

// Take last 20 messages for context
const recentMessages = parsedMessages.slice(-20);

const messages = [
  { role: 'system', content: instructions },
  ...recentMessages,
  // Add current message (only if not already the last parsed message)
];

// Add current user message + image context
const fullUserMessage = imageAnalysisContext
  ? `${userMessage}\n\n[IMAGE ANALYSIS CONTEXT]:${imageAnalysisContext}`
  : userMessage;

// Avoid duplicating if transcript already contains this message
const lastParsed = recentMessages[recentMessages.length - 1];
if (!lastParsed || lastParsed.role !== 'user' || lastParsed.content !== userMessage) {
  messages.push({ role: 'user', content: fullUserMessage });
}
```

**Change 2** — Add an explicit anti-repetition directive to the system prompt (around line ~1402, after the existing "NO REPETITIVE QUESTIONS" block):

```text
13. NEVER REPEAT YOUR GREETING:
    - If you already greeted the customer in this conversation, do NOT greet again
    - Check conversation history — if you see your own "Welcome" or greeting message, skip the greeting
    - Jump straight to answering the customer's current question
```

This ensures:
- The AI sees its own previous replies as `assistant` messages (proper chat format)
- The model naturally continues the conversation instead of restarting
- An explicit instruction reinforces no greeting repetition

| File | Change |
|------|--------|
| `supabase/functions/whatsapp-messages/index.ts` | Parse transcript into proper user/assistant message roles; add anti-greeting-repetition instruction |

