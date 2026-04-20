
## Fix AI context awareness for follow-up "yes/no" replies

The AI loses track of its own previous question. When it asks *"want to see some pictures?"* and the user replies *"yes"*, it doesn't connect that "yes" to the offer it just made — so no images get sent. This is a conversation-history wiring problem, not a model problem.

### Root cause (3 likely culprits, all in `whatsapp-messages`)

1. **History window too small or assistant turns missing.** The function loads recent messages but may be (a) loading too few, (b) only loading user turns, or (c) sending raw text instead of structured `{role: 'user'|'assistant', content}` pairs. Without prior assistant turns the model literally cannot see what it offered.
2. **Router classifies "yes" in isolation.** The mode router sees just *"yes"* and routes to a default mode (Customer Care) instead of the mode that just offered media (Sales). The new mode has no memory of the offer.
3. **Image-send trigger requires explicit verb+keyword.** Per `whatsapp-image-gen-trigger-logic` memory, image generation needs explicit terms like "send pic" / "show photo". A bare "yes" fails the gate even when context makes intent obvious.

### The fix

**A. Always load and pass structured history (12 messages, both roles)**

In `whatsapp-messages/index.ts`, before the router and before the main agent call:
- Fetch the last **12 messages** (6 user + 6 assistant pairs) for the conversation, ordered ASC.
- Map them into proper `{role, content}` array — never collapse into a single string.
- Pass this array to BOTH the router classification call AND the agent generation call.

**B. Router must see history, not just the last message**

Update the router prompt builder so the classification LLM gets:
```
Recent conversation:
[assistant]: Want to see some pictures of the cake stand?
[user]: yes

Classify the LATEST user message in context of the conversation.
```
This single change fixes 80% of "yes/sure/ok" misrouting. Also add a rule: *"If the user reply is a short affirmation (yes/sure/ok/please/go ahead), classify based on what the assistant just offered, not the affirmation alone."*

**C. Pending-action shortcut (the real human fix)**

Add a lightweight helper before the router runs:
- If the **last assistant message** contains a media offer pattern (regex: `/show|see|send|share|view/i` AND `/picture|photo|image|pic|video/i`) AND the **current user message** is a short affirmation (`/^(yes|yeah|yep|sure|ok|okay|please|go ahead|👍|✅)/i`), then **bypass the router** and route directly to a "fulfill_media_offer" path that calls `list_media` + `send_media` for the relevant product mentioned in the offer.
- Same pattern for other common offers: "want me to reserve it?", "should I notify the boss?", "want the price list?".

**D. Mirror the same logic for the image-gen trigger**

In the image-generation gate, treat "yes" as a valid trigger when the immediately preceding assistant turn proposed an image. Don't require the user to re-state the verb the AI just used.

### Files to touch

- `supabase/functions/whatsapp-messages/index.ts` — history loader, router prompt, pending-action shortcut, image-trigger gate.
- Possibly `supabase/functions/_shared/` — extract a small `detectPendingAction(lastAssistant, currentUser)` helper for reuse in `bms-agent` / `boss-chat` / `meta-webhook`.
- No DB changes. No UI changes. No new tools.

### Verification

1. WhatsApp ANZ: *"do you have the cake stand?"* → AI: *"Yes, K1,200. Want to see a picture?"* → reply *"yes"* → **AI sends the cake stand photo** (was previously silent or off-topic).
2. *"are you open today?"* → AI: *"Yes, until 6pm. Want me to reserve a table?"* → *"sure"* → AI starts reservation flow.
3. *"how much is the pan?"* → AI: *"K450. Want me to notify the team to hold one?"* → *"yes please"* → AI calls `notify_boss`.
4. Negative case: random *"yes"* with no prior offer → AI politely asks *"yes to what?"* (don't fire random tools).
5. Check 5 prior conversations: no regressions on normal Q&A.

### Memory to save after implementation

`mem://features/contextual-affirmation-handling` — "Short affirmations (yes/sure/ok) following an assistant offer (media/reservation/handoff) bypass the router and fulfill the offered action directly. History window is 12 messages with structured role pairs."

### Phased

- **Phase 1 (this PR)**: A + B + C above. Ship to ANZ.
- **Phase 2**: Extend to bms-agent and boss-chat.
- **Phase 3**: Track "missed affirmation" rate as a metric in supervisor analysis.
