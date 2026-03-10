

# Fix: analyze-and-followup Failing on Every Conversation

## Problem
The `analyze-and-followup` function fails on **100% of conversations** with:
```
"contents is not specified"
```

Every single log entry for this function shows this error. This means no post-conversation analysis, no follow-up messages, and no re-engagement is happening.

## Root Cause

**`supabase/functions/analyze-and-followup/index.ts` lines 290-332** — the `geminiChat` call only has a `system` message. No `user` message is provided. Gemini's API requires at least one user-role message.

```typescript
// Current (broken):
messages: [
  { role: 'system', content: '...' }  // ← only system, no user message
]
```

The conversation history (`conversationHistory`) is fetched on line 195 but never passed to the Gemini call.

## Fix

Add a `user` message containing the conversation transcript so Gemini has content to analyze:

```typescript
messages: [
  { role: 'system', content: '... (existing system prompt) ...' },
  { role: 'user', content: `Here is the conversation to analyze:\n\n${conversationHistory.map(m => `[${m.role}]: ${m.content}`).join('\n')}` }
]
```

This is a 3-line addition at line 331 (before the closing `]`).

## Impact
- Fixes follow-up message generation for all conversations
- Restores automated customer re-engagement
- Supervisor analysis pipeline will work end-to-end again

