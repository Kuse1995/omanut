

## Pending-promise watchdog — the AI must keep its word

### The actual problem (from ANZ ↔ 0967254226)

```
07:52:03  customer:  "I'd like to know what you have in stock and see some pictures"
07:52:14  AI:        "Give me one moment — I'm checking on that for you. 🙏"
                     ❌ never followed up
```

Same exact pattern the day before:

```
17:29:15  customer:  "I'd like to know what you have in stock and see some pictures"
17:29:24  AI:        "Give me one moment — I'm checking on that for you. 🙏"
17:34:06  customer:  "??"   ← customer had to nudge
17:34:29  AI:        "I've processed your request. Is there anything else I can help you with?"
                     ❌ meaningless — never actually delivered the catalog/pics
```

The AI is making a verbal promise ("one moment", "checking on that", "let me confirm") and then **abandoning the customer**. Existing systems don't catch it:

- `analyze-and-followup` runs only at 09:00, 14:00, 18:00 — too slow, and it's a *strategic re-engagement* job, not a promise-keeper.
- `sla-escalation` runs every 2 min but escalates to the boss — it does not make the AI itself fulfill the promise.
- The synthesis fallback in `whatsapp-messages` produces these "one moment" replies when the tool loop runs out of rounds with no usable result — the AI literally promises a follow-up it has no mechanism to deliver.

### The fix — a `pending-promise-watchdog` agent

A new edge function + every-minute cron that detects abandoned promises and makes the AI actually fulfill them within ~2 minutes, before the customer has to nudge.

#### 1. Detect a pending promise

A conversation has a pending promise when ALL of these are true:

- Last message is from `assistant`.
- That message matches a "promise pattern":
  - `/give me (one |a )?moment/i`
  - `/checking on (that|it|this)/i`
  - `/let me (check|confirm|verify|look)/i`
  - `/one moment\b/i`
  - `/i'?ll (get back|come back|check|confirm)/i`
  - `/working on (that|it)/i`
  - Any message ending with `… 🙏` or `… 🔍` or `… ⏳` and shorter than 80 chars (the synthesis fallback signature).
- At least **90 seconds** have passed since that assistant message (gives genuine tool loops time to finish naturally).
- No newer assistant message has been sent.
- Conversation `status = 'active'`.
- Company has `whatsapp_number` configured.

#### 2. Fulfill the promise (not re-engage)

For each detected pending promise:

1. Find the **last user message before** the promise — that's the actual question the AI failed to answer.
2. Re-run the WhatsApp pipeline by invoking `whatsapp-messages` programmatically with:
   - the original user question
   - the full conversation history
   - a system flag `isPromiseFulfillment: true` that prepends to the system prompt:
     > "You previously told the customer 'one moment, checking on that' but never delivered. Answer their question NOW using your tools (check_stock, list_products, search_media, etc.). Do NOT say 'one moment' again. Do NOT ask clarifying questions. Deliver the actual answer."
3. The new reply replaces the dead-end ack in the customer's experience.

If the second attempt also produces a "one moment" pattern (rare — model fully stuck), fall back to:
- Send `notify_boss(customer_issue)` with summary "AI failed to answer twice — please respond to {phone}".
- Send the customer: *"I'm having trouble pulling that up — the owner has been notified and will reply shortly."*

#### 3. Prevent loops

Add a `metadata.promise_fulfillment_attempts` counter on the conversation row. Skip if already attempted in the last 10 minutes for the same promise message. Hard cap: 1 fulfillment attempt per promise.

#### 4. Run frequency

Cron schedule: `*/1 * * * *` (every minute). Each run:
- Scans `conversations` where `status='active'` AND `last_message_at > now() - interval '15 minutes'`.
- Per company budget: max 5 fulfillments per run to avoid runaway cost.

#### 5. Observability

Log per detection:
```
[PROMISE-WATCHDOG] conv=<id> phone=<phone> promise="<text>" age=<sec> action=fulfill|skip|escalate
```

Add a memory note in `mem://features/pending-promise-watchdog.md` so future drift doesn't reintroduce dead-end "one moment" replies.

---

### Files

**New:**
- `supabase/functions/pending-promise-watchdog/index.ts` — the agent.
- DB migration: cron job `pending-promise-watchdog` on `*/1 * * * *`.
- `mem://features/pending-promise-watchdog.md`.

**Edited:**
- `supabase/functions/whatsapp-messages/index.ts` — accept `isPromiseFulfillment` flag in body and inject the "answer now, don't stall" prompt prefix.

**No changes:** schema, tools, UI, prompts for normal flows, `analyze-and-followup` (keeps its strategic re-engagement role).

### Acceptance test

Manually replay the failing turn for ANZ ↔ 0967254226:
1. Send "I'd like to know what you have in stock and see some pictures" again.
2. If the AI replies "one moment", wait 90 seconds.
3. Within ~120 seconds total, the watchdog must send the actual catalog + media.
4. No "??" nudge required from the customer.

