
## What’s actually broken (from code + data)
1) **Web chat “Send message” is WhatsApp-only right now**
- `src/pages/Conversations.tsx` always calls the `send-whatsapp-message` backend function, even when the conversation is Facebook/Instagram.
- `src/components/conversations/ChatView.tsx` **hides the input entirely** for `fbdm:` and `igdm:` conversations (`isMetaDM`), so you can’t take over and reply.

2) **Boss WhatsApp “lead summaries from Facebook” are not automatic anymore**
- Your Facebook/Instagram messages/comments are being stored as `conversations` with prefixes like `fb:…`, `fbdm:…`, `ig:…`, `igdm:…` (confirmed in DB).
- But `supabase/functions/meta-webhook/index.ts` **never triggers a “boss notification / lead alert”**. It replies to the customer on Meta and saves to DB, but doesn’t push a WhatsApp alert to the boss.

3) **Boss chat not responding (intermittent)**
- Boss-chat replies depend on Twilio → `whatsapp-messages` receiving the inbound message, then calling `boss-chat`.
- The code currently looks up the company via an **exact** match on `companies.whatsapp_number` == Twilio `To`. If the incoming `To` formatting changed (missing `whatsapp:` prefix, whitespace, etc.), boss messages can silently stop routing.

---

## Goal
Restore the old “boss experience”:
- **Automatic WhatsApp lead alerts** when new Facebook/Instagram/Messenger/IG DM activity happens (especially ads leads / buying intent).
- **Boss chat works reliably** again.
- **Web chat can reply** to Facebook/Instagram DMs (and optionally comments, if desired).

---

## Plan (implementation)

### A) Make boss chat routing resilient (WhatsApp inbound)
**File:** `supabase/functions/whatsapp-messages/index.ts`

1. **Harden company lookup for inbound WhatsApp**
   - Normalize both values (strip `whatsapp:`, remove `+`, spaces) and match on the normalized number.
   - Fallback lookup:
     - If exact `.eq('whatsapp_number', To)` fails, try an `.ilike`/contains match on normalized digits.
   - Add explicit logs when:
     - company lookup fails
     - message is detected as boss message
     - `boss-chat` invoke fails (include error payload)

2. **Make boss detection more tolerant**
   - Today it compares normalized From vs normalized `boss_phone`/`takeover_number`.
   - Ensure `boss_phone` stored either as `+260…` or `whatsapp:+260…` still matches.

**Result:** Boss messages will route again even if Twilio formatting changes.

---

### B) Add automatic “Meta lead → Boss WhatsApp alert” pipeline
**Files:**
- `supabase/functions/meta-webhook/index.ts`
- (new) `supabase/functions/meta-lead-alert/index.ts` (recommended for clarity & reuse)

**Approach**
1. When `meta-webhook` processes:
   - Messenger DM (`fbdm:`)
   - Instagram DM (`igdm:`)
   - Facebook comment (`fb:`)
   - Instagram comment (`ig:`)
   
   …it will enqueue a background task that calls `meta-lead-alert` with:
   - `company_id`
   - `conversation_id` (from `saveInteraction`)
   - `platform`
   - last user message text, customer name/ids, metadata

2. `meta-lead-alert` will:
   - Load company config (`company_ai_overrides`) to respect thresholds.
   - Run a lightweight lead classifier (Lovable AI model) returning:
     - `lead_score` (0–100)
     - `intent` (support / sales / neutral)
     - `recommended_action`
     - `summary_for_boss` (2–6 lines)
   - **Dedupe/throttle** so the boss doesn’t get spammed:
     - Only alert once per conversation per X minutes, and only if score >= threshold.

3. Send WhatsApp message to boss:
   - Reuse your existing notification mechanics (Twilio path already used elsewhere).
   - Message format example:
     ```text
     🔥 New Meta Lead (Messenger)
     Customer: <name> (fbdm:123…)
     Message: "<last message>"
     Why it matters: <1 line>
     Next step: <1 line>
     ```

**Optional but recommended DB support (for dedupe):**
- New table: `meta_lead_alerts`
  - `company_id`, `conversation_id`, `platform`, `lead_score`, `created_at`
- RLS: readable by company members; inserts by system only.

**Result:** You regain “AI sends boss summaries of leads from Facebook/Instagram” automatically.

---

### C) Enable web chat replies for Meta DMs (Messenger + Instagram DM)
**Files:**
- `src/components/conversations/ChatView.tsx`
- `src/pages/Conversations.tsx`
- (new) `supabase/functions/send-meta-dm/index.ts`

1. **UI: allow takeover + input for `fbdm:` and `igdm:`**
   - Remove the `isMetaDM` block that shows “handled automatically”.
   - Treat Meta DMs like WhatsApp chats:
     - show “Take Over / Release”
     - show message input when `human_takeover === true`

2. **Routing: send via correct backend**
   - In `sendMessage()` detect destination:
     - `phone.startsWith('fbdm:')` → Messenger DM
     - `phone.startsWith('igdm:')` → Instagram DM
     - else → WhatsApp
   - Call:
     - WhatsApp → existing `send-whatsapp-message`
     - Meta DM → new `send-meta-dm`

3. **Backend: `send-meta-dm`**
   - Auth-required (dashboard users only).
   - Input: `{ conversationId, text }`
   - Load conversation → get `company_id` + `phone` (`fbdm:PSID` / `igdm:IG_SCOPED_ID`)
   - Load `meta_credentials` by `company_id` to get `access_token` (+ `ig_user_id` if needed)
   - Send via Graph API (`/me/messages`) with the same token already used in `meta-webhook`
   - Insert the outgoing assistant message into `messages` so it appears in the UI.

**Result:** Agents can reply from the web inbox to Messenger/Instagram DMs.

---

### D) Restore “on-demand hot leads” in boss chat (quality improvement)
**File:** `supabase/functions/boss-chat/index.ts`

- Add a dedicated command pattern:
  - “hot leads”, “leads”, “facebook leads”, “instagram leads”, “ads leads”
- When detected:
  - Query recent conversations across platforms (including `fb:*`, `fbdm:*`, `ig:*`, `igdm:*`)
  - Rank by simple heuristics + optional AI scoring
  - Reply with top 5 leads + next steps
- This complements automatic alerts and gives you a reliable manual fallback.

---

## Testing plan (end-to-end)
1. **Boss chat**
   - Send WhatsApp to the business number from the boss phone; confirm boss receives reply.
2. **Meta lead alerts**
   - Send a real Messenger DM and an Instagram DM; confirm boss WhatsApp receives a “New Meta Lead” alert within ~5–15s.
3. **Web inbox replies**
   - Open the `fbdm:` conversation, click Take Over, send a message; verify it delivers on Messenger and saves to the timeline.
4. Regression: WhatsApp sending from web chat still works.

---

<lov-actions>
<lov-suggestion message="Test end-to-end: send a real Messenger DM + Instagram DM and confirm (1) it appears in Conversations, (2) boss gets a WhatsApp lead alert, and (3) you can reply from the web inbox.">Verify end-to-end</lov-suggestion>
<lov-suggestion message="Enable human takeover + manual replying for Messenger (fbdm:) and Instagram DMs (igdm:) in the Conversations web inbox, routed via a new send-meta-dm backend function.">Fix web inbox Meta replies</lov-suggestion>
<lov-suggestion message="Add automatic lead alerting from meta-webhook to the boss WhatsApp number with dedupe/throttling so important Meta leads always trigger a WhatsApp summary.">Restore automatic Meta lead alerts</lov-suggestion>
<lov-suggestion message="Harden WhatsApp inbound routing by normalizing Twilio 'To' numbers so boss chat never breaks due to formatting changes.">Stabilize boss chat routing</lov-suggestion>
<lov-suggestion message="Add a boss-chat command 'hot leads' that returns top cross-platform leads (WhatsApp + Facebook + Instagram) with next actions, even if automatic alerts are missed.">Add boss 'hot leads' command</lov-suggestion>
</lov-actions>
