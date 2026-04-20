---
name: Contextual Affirmation Handling
description: Short "yes/sure/ok" replies are linked to the assistant's prior offer so the AI fulfills it instead of asking "yes to what?"
type: feature
---
When a customer's WhatsApp message is a short affirmation (yes/yeah/sure/ok/please/👍/✅), `whatsapp-messages/index.ts` runs `detectPendingAction()` (in `supabase/functions/_shared/pending-action.ts`) against the last 12 messages of structured conversation history. If the immediately preceding assistant turn contains a media offer, reservation offer, handoff offer, price-list offer, or order offer, the system:

1. **Augments the router prompt** with an `AFFIRMATION CONTEXT` block telling the classifier to route based on what the assistant just offered, not the bare "yes".
2. **Injects a `[CONTEXT]` hint into the agent's user message** (`describePendingActionForAgent`) telling the agent exactly which tool to call (`send_media`, `notify_boss`, `create_reservation`, etc.) instead of asking the customer to clarify.

History window is **12 messages** with structured `{role, content}` pairs (already in place).

Pre-existing parse error in the agent instruction template literal (raw backticks around `|` and `---`) was fixed at the same time so the function can deploy.
