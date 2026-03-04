

# Plan: Fix Demo Handoff Notifications and Ticket Logging

## Problem Analysis

Two issues identified in the `demo-session` edge function:

### Issue 1: Over-aggressive boss notifications
The `evaluateAndHandoff` function runs after every single message and uses an AI evaluation agent. The handoff prompt's "soft handoff" criteria are too broad — phrases like "Customer has a complaint that requires real-world resolution" and "Customer is negotiating a deal" cause the AI evaluator to trigger on routine questions (e.g., "how do I withdraw money?"). The word "why" is even listed in the complexity classifier as a complex trigger, but the real problem is the handoff evaluation prompt itself.

### Issue 2: Handoffs not creating tickets or queue items
When a handoff IS triggered, the function only sends a WhatsApp message to the boss (`sendWhatsAppToBoss`). It never inserts rows into `support_tickets` or `agent_queue` tables. Since the `demo-live-feed` endpoint reads from those tables, the pitch page's Tickets and Queue tabs remain empty.

## Changes

### File: `supabase/functions/demo-session/index.ts`

**1. Tighten handoff evaluation prompt**

Update the `evaluateAndHandoff` function's evaluation prompt to be much stricter:
- Remove "complaint that requires real-world resolution" from soft handoff (too vague — the AI answering "how to withdraw" gets flagged as complaint-adjacent)
- Add explicit "NO HANDOFF" examples: answering FAQs, explaining processes, providing information about services
- Require at least 3 messages before any soft handoff evaluation (skip evaluation on early messages)
- Add a minimum conversation depth check — don't evaluate if fewer than 4 messages total

**2. Create tickets and queue items on handoff**

After the handoff decision is made and before sending the boss WhatsApp notification, insert:

- A `support_tickets` row with:
  - `company_id`, `customer_name`, `customer_phone`
  - `issue_summary` from the AI's `result.summary`
  - `issue_category` derived from the handoff type (complaint, order, booking)
  - `priority` from `extracted_data.urgency` mapped to ticket priority
  - `status`: "open"
  - `recommended_department` based on category
  - `conversation_id` linked to the demo conversation

- An `agent_queue` row with:
  - `company_id`, `ticket_id` (from the ticket just created)
  - `conversation_id`, `customer_name`, `customer_phone`
  - `priority` matching the ticket
  - `status`: "waiting"
  - `department` from recommended department
  - `ai_summary` from the handoff summary
  - `sla_deadline` set to 15 minutes from now (for demo urgency feel)

**3. Skip evaluation on short conversations**

Add a guard at the top of `evaluateAndHandoff`: if the conversation has fewer than 4 messages (2 exchanges), return immediately without evaluating. This prevents first-message or second-message false positives.

### Summary of behavior after fix

| Scenario | Before | After |
|----------|--------|-------|
| Customer asks "how do I withdraw?" | Boss gets notified | AI answers, no notification |
| Customer asks 3 FAQs | Boss gets 3 notifications | No notifications |
| Customer files complaint after 3+ exchanges | Boss gets WhatsApp only | Boss gets WhatsApp + ticket created + queue item visible on pitch page |
| Customer completes a booking | Boss gets WhatsApp only | Boss gets WhatsApp + ticket + queue item on pitch page |

### Files

| Action | File |
|--------|------|
| Edit | `supabase/functions/demo-session/index.ts` |

