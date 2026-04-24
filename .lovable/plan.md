

## Two real bugs, two real fixes

### Bug A — AI says "posted!" but the post is sitting unpublished

**Customer-facing `create_scheduled_post` (used in WhatsApp/Meta DMs) inserts every post with `status: "pending_approval"`** (`supabase/functions/mcp-server/index.ts` line 770). It is then never auto-published. The cron (`cron-publisher`) only picks up rows with `status='approved'` — so the post sits forever.

The boss-chat path is correct: when the boss says "publish now" or "post it", `boss-chat/index.ts` lines 1879–1909 actually inserts with `status='approved'` and immediately calls `publish-meta-post`. The bug is only on the customer/agent path.

But the AI prompt cheerfully says "✅ posted!" because the tool returned `success: true` with `action: "created"`. The model can't tell that "created" ≠ "published".

**Fix**

1. In `mcp-server/index.ts` `create_scheduled_post` handler, return a clearly-worded result the model can't misread:
   ```
   { action: "draft_saved", status: "pending_approval", message: "Saved as a draft awaiting boss approval. NOT yet published." }
   ```
   And include `boss_will_be_notified: true` in the payload.
2. After insert, fire `send-boss-notification` (already exists) so the boss gets a WhatsApp ping: *"New AI-drafted post pending your approval — reply 'approve' to publish."* with the `pendingPostId`. This is the same flow as the boss-chat draft path.
3. Tighten the customer-channel prompt block in `whatsapp-messages/index.ts` (search for the "scheduled_post" section in the system prompt assembly): replace any "say it's posted" wording with **"NEVER tell the customer the post is published. Say it's been queued for owner review and will go live once approved."** Add this same rule to the `meta-webhook` / DM prompt path if it surfaces this tool.
4. (Optional, recommended) Split the tool: keep `create_scheduled_post` as the draft path, and make a separate `request_immediate_publish` that requires explicit boss approval token — so the AI can't accidentally claim immediate publish on a customer turn.
5. Validation: customer asks "make a post about X" → AI replies "Drafted — waiting for owner approval"; boss receives WhatsApp preview; boss replies "approve" → existing `review_pending_post` flips it to `approved`; cron-publisher picks it up within 60s and publishes; boss gets confirmation.

### Bug B — Handoff fires the customer ack but never reaches the boss

In `whatsapp-messages/index.ts` lines **5421–5432**, the `notify_boss` tool handler does only this:
```ts
await supabase.from('boss_conversations').insert({ ... });
return { success: true, message: 'Boss notified successfully' };
```
**It writes a row and lies to the model.** No WhatsApp message is sent to the boss. The model then tells the customer "the owner has been notified" — and the owner is not. Same broken assumption in the parallel handler at line 4108.

The hybrid/human-first flow at line 1853–1871 *does* call `sendBossHandoffNotification` correctly. The bug is only in the autonomous-agent tool path — the most common path.

**Fix**

1. Replace the `notify_boss` tool body in both locations (lines ~4108 and ~5421) to actually call `sendBossHandoffNotification(company, customerPhone, conversation.customer_name, summary, supabase, 'ai_tool', { askingAbout: userMessage, stage: args.notification_type, triggerReason: args.summary, collectedInfo })` — the function already exists (line 1102), already retries within the 24h service window, and already falls back to `boss_conversations` when the window is closed.
2. If the WhatsApp send fails, return `{ success: false, error: 'boss_unreachable' }` so the model doesn't claim escalation succeeded — let it tell the customer plainly: *"I've logged your request and the team will follow up."*
3. Log every `notify_boss` call to `ai_error_logs` with severity `info` if delivered, `critical` if WhatsApp send to boss failed 3× — surfaces in the AI Error Tracker so we can monitor handoff health before ads go live.
4. Tighten handoff trigger coverage in the prompt: explicitly list when `notify_boss` MUST be called (severe complaint, refund request, legal/threat language, payment confusion, repeat frustration ≥2 turns, "speak to a human", bulk order ≥5 units, anything the AI tried 2× and failed). Currently it's vague — that's why customers report under-triggering.
5. Add an idempotency guard: don't fire `notify_boss` for the same conversation more than once per 30 min unless the user explicitly re-asks for a human.

### Files

- **`supabase/functions/mcp-server/index.ts`** — rewrite `create_scheduled_post` response shape; trigger `send-boss-notification` after insert.
- **`supabase/functions/whatsapp-messages/index.ts`** — replace both `notify_boss` tool bodies (lines ~4108 & ~5421) to call `sendBossHandoffNotification`; expand handoff trigger list in system-prompt assembly; add 30-min idempotency guard.
- (No new edge function needed — `send-boss-notification` and `publish-meta-post` already exist.)
- **`mem://features/handoff-notification-contract.md`** — new memory documenting that `notify_boss` MUST send a real WhatsApp ping, not just write a row.

### Validation

1. Customer says "make a Facebook post about our new arrivals" → tool returns `draft_saved`; AI replies "Drafted, sent to owner for approval"; boss WhatsApp shows preview; boss approves; cron publishes; Meta post live within 60s.
2. Customer says "I want to speak to a human" → `notify_boss` runs → boss receives a real WhatsApp message with summary + collected info → AI tells customer truthfully.
3. Force `boss_phone` empty for a test company → `notify_boss` returns `success:false` → AI gives a graceful fallback, not the false "owner notified" line.
4. Tail logs for 24h post-deploy: every `[TOOL-LOOP] notify_boss` line is followed by a `[HANDOFF] Boss notification sent successfully` line. Zero "false escalation" reports.
5. AI Error Tracker shows a new "handoff_failed" category with count = 0 in healthy state.

No DB schema changes. No frontend changes. No RLS changes.

