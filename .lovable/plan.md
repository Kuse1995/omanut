# Make ANZ chats enterprise-ready for paid Facebook ads

## What's actually broken (evidence from production data)

I pulled the last 7 days of ANZ chats. Three concrete problems are eating into the ad spend you're running:

### 1. 59% of paid ad clicks are ghosting after one reply
- 59 customers in 7 days clicked your Click-to-WhatsApp ad ("Send Message" button on a Facebook ad).
- Meta auto-sends the message `"Hello! Can I get more info on this?"` on the customer's behalf.
- Your AI replies with a generic `"Welcome to ANZ! Which product would you like info about?"`
- 35 of those 59 customers (59%) **never sent another message**. They expected the AI to already know which product they tapped on. It didn't.

Root cause: Meta forwards an `ad_referral` payload with every CTWA inbound (headline, body text, source URL, image URL, ad ID). Both our **Twilio webhook** and our **Meta Cloud API webhook** ignore those fields completely. So the AI literally has no idea the customer just clicked an ad for, say, "Whistling Kettle K720".

### 2. AI is leaking raw tool-call syntax in Chinese to customers
One conversation (Nox Sapilinya, Apr 25) received this as the reply:
> `tool_calls参数（需要保持原语言不变）：[{"name": "notify_boss", "arguments": "{}"}]`

That's the Zhipu `glm-4.7` model (currently set as ANZ's primary model) failing to format a function call and dumping it as plain text. Unacceptable in front of a paying customer.

### 3. AI asks "yes to what?" instead of fulfilling the prior offer
The contextual-affirmation memory rule exists, but in the Mwazanji chat the AI replied "Great! Would you like to come visit us, or are you interested in ordering online?" after the customer just said "Yes" to its own previous offer. It's still re-asking instead of acting.

Also, when the customer fires two messages in quick succession ("Yes" + "Location"), the AI replies twice in 4 seconds instead of merging them into one coherent answer — feels robotic.

---

## The fix (4 changes, in priority order)

### Fix 1 — Capture Meta ad referral context (biggest revenue impact)

Both inbound webhooks (Twilio + Meta Cloud) will extract and persist the `referral` payload that comes attached to the very first message of a CTWA conversation:

- `ReferralHeadline` — e.g. "Whistling Kettle - K720"
- `ReferralBody` — the ad's body copy
- `ReferralSourceUrl` — link to the FB post / ad
- `ReferralSourceId` — Meta `ad_id` (joins to `meta_ad_campaigns`)
- `ReferralMediaUrl` — the ad's image
- `ctwa_clid` — click-to-WhatsApp tracking id

We store this on the `conversations` row in a new `ad_context` JSONB column AND inject it into the AI's system prompt for the first ~3 turns:

```text
[AD CONTEXT — customer just clicked your Facebook ad]
Headline: Whistling Kettle K720 — copper finish
Body: 4 colours available, lifetime warranty
Image: <url>
→ Open the conversation by referencing this product directly.
   Do NOT ask "which product are you interested in?".
```

This single change should turn most of the 35 ghosted leads/week into engaged conversations.

### Fix 2 — Switch ANZ's primary model away from Zhipu glm-4.7

`glm-4.7` is occasionally emitting raw Chinese tool-call syntax to customers. Two options:

- **Recommended**: switch primary to `google/gemini-2.5-flash` (proven, fast, no leak history in our logs) and keep `glm-4.7` as a fallback only.
- Add a defensive output filter: if assistant text matches `/tool_calls|参数|"name":\s*"\w+_\w+"/`, suppress, retry with backup model, and never deliver to customer.

We'll do **both** — model swap + safety filter — so even if any model misbehaves the customer never sees JSON/Chinese leakage.

### Fix 3 — Strengthen affirmation + burst handling

- **Burst coalescing**: if a second customer message arrives within 6s of the first, queue + merge them before calling the AI (instead of firing two parallel runs). Already partly built in `pending-promise-watchdog`; we extend it for inbound bursts.
- **Affirmation rule reinforcement**: tighten the contextual-affirmation prompt block so single-word replies ("Yes", "Ok", "Sure", "Show me") MUST trigger fulfilment of the assistant's last concrete offer, never a re-ask. Add a hard rule: if the previous assistant turn ended with `"Would you like…?"` and the user replies with an affirmation, the next assistant turn cannot be a question.

### Fix 4 — Ad-aware lead alerts to the boss

When a CTWA-sourced lead converts into intent (price asked, availability asked, "I want to buy"), the boss WhatsApp ping includes:

```
🔥 LEAD from FB ad "Whistling Kettle K720"
Customer: Diane (+260964349486)
Spent on this ad so far today: K42 / K100
Status: asked about delivery
```

This pulls from `meta_ad_insights_daily` (already exists from the ads work) and closes the loop so you/the client can see which ads convert.

---

## Technical changes

### Database
```sql
ALTER TABLE conversations
  ADD COLUMN ad_context jsonb,
  ADD COLUMN ad_referral_id text,
  ADD COLUMN ctwa_clid text;

CREATE INDEX idx_conversations_ad_referral ON conversations(ad_referral_id) WHERE ad_referral_id IS NOT NULL;
```

### Edge functions
- `whatsapp-messages/index.ts` — parse `ReferralHeadline`, `ReferralBody`, `ReferralSourceUrl`, `ReferralSourceId`, `ReferralMediaUrl`, `ReferralNumMedia`, `ReferralCtwaClid` from Twilio form data on first inbound; persist to `conversations.ad_context`.
- `meta-webhook/index.ts` — same for the WhatsApp Cloud API `referral` object.
- `whatsapp-messages/index.ts` (prompt builder) — when `conversations.ad_context` is set and the conversation has ≤3 assistant turns, inject the AD CONTEXT block at the top of the system prompt.
- `whatsapp-messages/index.ts` (output guard) — regex filter on assistant text before send; on hit, log to `ai_error_logs`, retry once with `gemini-2.5-flash`, and if it still fails escalate to boss instead of replying.
- `whatsapp-messages/index.ts` (burst coalescing) — short Redis-less debounce: if a new message arrives for the same `conversation_id` within 6s of an in-flight run, append to the run's input and abort the earlier reply.
- `meta-lead-alert/index.ts` — include ad headline + today's ad spend on lead alerts when `conversations.ad_context` is set.

### Config
- Update `company_ai_overrides` for ANZ: set `primary_model = 'google/gemini-2.5-flash'`, keep current as fallback.
- Tighten affirmation rule in the system instructions block.

### Memory updates
- New `mem://features/ctwa-ad-context-injection.md` documenting the referral capture contract.
- Update `mem://features/contextual-affirmation-handling.md` with the "no re-question after affirmation" hard rule.

---

## Out of scope for this round
- Re-trying the 35 already-ghosted leads (we can do a one-off re-engagement campaign separately if you want).
- Image recognition of the ad image to auto-attach product photo (nice-to-have, later).
- Ad-spend attribution dashboard in the admin UI (Tier-2 ads UI already shows insights; per-conversation ROI view can be a follow-up).

---

## Expected outcome
- CTWA ghost rate from ~59% → target <25% within a week of rollout.
- Zero "tool_calls" / Chinese-character leaks to customers (hard guarantee via output filter).
- Boss alerts now show *which ad* drove each lead, so you can pause losers and double down on winners.
