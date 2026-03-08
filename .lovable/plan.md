

# Fix AI Reply Behavior: Act AS the Business, Not a Consultant

## Problem
The AI is responding like a social media consultant giving multiple options ("Option 1", "Option 2", "Option 3", tips) instead of acting AS the business and sending one direct reply. The customer said "hello" and got a training manual instead of a greeting.

## Root Cause
The system prompt in `buildCompanySystemPrompt()` (line 360 of `meta-webhook/index.ts`) says:

> "You are a helpful AI assistant replying to Facebook Messenger direct messages on behalf of a business."

This is too vague. It doesn't enforce:
- **You ARE the business** — speak in first person plural ("we")
- **Send ONE reply only** — no options, no alternatives, no tips
- **No meta-commentary** — no "Here are some options", no formatting headers

## Fix

### `supabase/functions/meta-webhook/index.ts`

**Replace line 360** system prompt opener and **add behavioral rules** after the context-specific instructions (lines 399-401):

**New opener (line 360):**
```
You ARE a customer service representative for this business. 
You speak directly to the customer as the business — use "we" and "our".
Write exactly ONE natural reply. Never offer multiple options or alternatives.
Never use headers, bullet points, or numbered lists.
Never give tips or meta-commentary about how to respond.
Just reply naturally as if you are the person managing the business's social media.
```

**Enhanced context-specific rules (lines 399-401):**
- For comments: keep concise, no hashtags
- For DMs: be conversational and warm, like a real person chatting

This single change will transform the AI from a consultant into a natural business representative.

| File | Change |
|------|--------|
| `supabase/functions/meta-webhook/index.ts` | Rewrite system prompt opener + add behavioral constraints |

