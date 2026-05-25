# Omanut v2 — Production Refactor Brief (Revised)

Targeted refactor + extension of the live Omanut stack. We preserve `build-zambia-handler`, `mcp_active_company` routing, MiniMax-M2 default, ANZ baseline, swarm v2, BMS auto-sync, autonomous checkout authority, 8s grace fallback, and the missed-lead triple-guard. Nothing below replaces those — it extends them.

---

## Section 0 — Non-negotiables to preserve

- One external OpenClaw, many tenants via `set_active_company`. No per-tenant deploys.
- `PRIMARY_TEXT_MODEL` env override stays as the instant rollback lever.
- Existing pull-based `inbound_events` bus + `claim_inbound_event` RPC are the only outbound chokepoint we extend. No parallel queues.
- `company_ai_overrides`, `company_agent_modes`, `company_documents` + `match_documents` already exist. Extend, never duplicate.
- Conversation pause/takeover already lives on `conversations` (`human_takeover`, `takeover_at`, `takeover_by`). No mirror table.

---

## Section 1 — Persona injection (fix #1: kill token burn)

Add to existing `company_ai_overrides`:
- `tone_voice_guide text`
- `escalation_triggers text[]`

**Persona is injected once per conversation, never per tool call.**

Mechanism:
1. `set_active_company` (the MCP handshake / first tool call of a thread) computes `persona_key = sha256(company_ai_overrides_row || agent_mode_row)` and returns the **full persona block** in the response.
2. The same `persona_key` is written to `conversations.metadata.persona_key`.
3. Every subsequent tool envelope in that conversation carries only `{ company_id, persona_key }` — no persona body.
4. If an owner edits overrides, a trigger bumps `company_ai_overrides.persona_version`. Next envelope detects `persona_key` mismatch, sets `persona_invalidated: true`, and re-sends the full block once.

Result: persona ships once per thread, not per tool call. Token cost stays flat regardless of tool-call depth.

---

## Section 2 — escalation_triggers spec (fix #8)

`escalation_triggers text[]` is **prompt-only**. No trigger → priority mapping table.

The strings are inlined into the system prompt under "Escalate to owner when…". The AI picks `notify_boss` priority from prompt context exactly as it does today. Documented explicitly in `OPENCLAW_INTEGRATION.md` so implementers don't build an unused mapping layer.

---

## Section 3 — Wizard state machine (fix #5)

Extend `company_onboarding_drafts`:
- `wizard_state enum('not_started','in_progress','meta_pending_verification','billing_pending','complete')`
- `current_step int` (already exists — wizard resumes from it)
- `step_errors jsonb` — per-step failure log, never blocks resume

Partial failures **never invalidate the draft**. Each step writes independently. Dropping off at step 7 with Meta half-connected lands the draft in `meta_pending_verification` and the wizard resumes there next login.

---

## Section 4 — Meta OAuth reality (fix #2)

No "one-click" claim. The wizard surfaces the real Meta states:

| State | What's happening | User action |
|---|---|---|
| `meta_oauth_initiated` | Token exchanged via FB JS SDK | none |
| `meta_domain_verification_required` | We display `.well-known/meta` file + HTML meta tag | Paste into their site, click "verify" |
| `meta_business_verification_pending` | Meta-side review, can take days | Wait — we poll Meta Graph API hourly |
| `meta_whatsapp_number_pending` | Phone ownership SMS/voice code | Enter code |
| `meta_connected` | All green | Done |

State persisted in `meta_credentials.connection_state`. Wizard's `wizard_state = 'meta_pending_verification'` is a **valid resting state**, not a failure. Companies in this state can still use Twilio WhatsApp (existing provider toggle handles it).

Start Meta domain + business verification in **week 1**, in parallel with everything else, so it doesn't surprise us in week 6.

---

## Section 5 — Sandbox / go-live gate (fix #3)

WhatsApp/Meta don't have real sandbox modes. We gate **outbound only**:

- New: `companies.is_live bool default false`
- **Inbound webhooks always flow** into `inbound_events`. We need the data to test the AI loop.
- All outbound dispatchers (`send-whatsapp-cloud`, `send-twilio-message`, `send-meta-dm`, `send-fb-comment-reply`, `meta-ads-launch`) check `is_live`:
  - `true` → real provider call
  - `false` → write to new `test_outbound_log` table + surface in `/admin/sandbox-console`. No provider call.
- Feature flag `SANDBOX_ENFORCEMENT` env var lets us disable the gate globally if needed.
- Final wizard step flips `is_live = true` only after a "send test message to my own number" passes.

This is the chokepoint. Belt-and-braces: dispatcher-level check + env flag.

---

## Section 6 — Approval queue (scoped, not blanket)

Intercepts outbound when **either**:
- `companies.metadata.sales_mode = 'human_in_loop'`, OR
- Risk threshold tripped: spend > company limit, refund keyword, legal keyword, or `escalation_triggers` match.

Autonomous checkout authority + ANZ baseline are untouched. The queue lives in a new `outbound_approval_queue` table; dispatchers check it before sending.

---

## Section 7 — Safety-only bypass (fix #4)

Triggered when the swarm circuit breaker trips OR `sales_mode = 'safety_only'`. The AI is **not** authoring debt-collection notices.

Strict tool whitelist in this mode:
- `notify_boss` ✓
- `bms_who_owes` ✓ (read-only research)
- `send_message` ✓ **only if `recipient_type = 'owner'`**
- Everything customer-facing ✗

Codified in new `_shared/safety-mode-gate.ts`, imported by every outbound dispatcher. The AI becomes a research assistant for the owner; the owner reads the ledger output in boss-chat, drafts the message, hits send. No self-authorized collection messages.

---

## Section 8 — Billing tiers (layer, don't replace)

Existing `credit_balance` + `credit_usage` + `deduct_credits` RPC stay. Add:
- `companies.subscription_tier enum('hustler','starter','pro','enterprise')`
- Monthly credit grant via cron, sized by tier
- Per-message cost multiplier read by `deduct_credits` callers

K0.50/message is **derived** from tier × base rate, never stored as a column.

---

## Section 9 — Knowledge base sync (fix #6)

Existing `company_documents` + `match_documents` + RLS via `user_has_company_access_v2` stay. Add:

- New edge fn `embed-document` invoked via `pg_net` from a trigger on `company_documents` INSERT/UPDATE (fire-and-forget; no blocking writes).
- New columns: `kb_sync_status enum('pending','syncing','synced','failed')`, `kb_sync_error text`, `kb_synced_at timestamptz`.
- `match_documents` RPC filters to `kb_sync_status = 'synced'` only — **AI never serves stale knowledge**.
- `/setup` KB card shows per-doc sync status.
- Backfill marks all existing docs `synced` (no mass re-embed) until first edit.

---

## Section 10 — Image-gen unlock gate (fix #7)

Add to `company_media`:
- `asset_validation_status enum('pending','approved','rejected')`
- `validation_reason text`
- Min resolution **800×800** enforced at upload in `media-upload` edge fn (smaller is rejected outright).

Unlock rule: `companies.image_gen_unlocked = true` requires **≥3 `company_media` rows with `asset_validation_status = 'approved'`**.

Approval flow:
1. Upload → Gemini vision quality check (resolution, clarity, on-brand, not a screenshot of text).
2. Confident pass → auto-approved.
3. Borderline → admin approval queue at `/admin/media-approvals`.
4. Garbage → auto-rejected with reason.

Gate enforced in `whatsapp-messages` + `generate-business-image` reading `image_gen_unlocked`, not in the wizard UI (wizard just shows progress).

---

## Section 11 — Conversation control (fix #9: no mirror table)

No `conversation_control_states` table. We extend the **authoritative** `conversations` columns:

- Already exists: `human_takeover`, `takeover_at`, `takeover_by`
- Add only: `paused_reason text`, `paused_until timestamptz` (for time-boxed pauses)

New `/admin/conversations/:id/control` UI reads/writes these fields directly. OpenClaw and Omanut UI share one source of truth — no drift possible.

---

## Section 12 — Observability (Day-1 realistic)

- Structured JSON logs from every edge function (mostly already there).
- New `system_metrics` table: `(company_id, metric, value, recorded_at)`.
- New `/admin/observability` page: event latency, token spend, error rate, BMS tool timeouts, persona-cache hit rate.
- Prometheus scrape endpoint + Loki/Grafana wiring → **deferred to Tier 2**. Not Day-1.

---

## Section 13 — Migration & rollback

Feature flags (env vars) for every new gate so any single piece can be killed in seconds:
- `SANDBOX_ENFORCEMENT` (default off → on after burn-in)
- `APPROVAL_QUEUE_ENABLED`
- `BILLING_TIER_ENFORCEMENT`
- `IMAGE_GEN_GATE_ENABLED`
- `KB_SYNC_FILTER_ENABLED`
- `PERSONA_CACHE_ENABLED`

Backfill for existing companies:
- `is_live = true`
- `wizard_state = 'complete'`
- `subscription_tier = 'starter'`
- `image_gen_unlocked` inherited from current state
- `kb_sync_status = 'synced'` on all `company_documents` (no mass re-embed)

---

## Section 14 — Out of scope (call it out)

- No rewrite of `build-zambia-handler` or MCP routing.
- No new chat-model wiring beyond what `PRIMARY_TEXT_MODEL` already does.
- No Loki/Grafana, no Prometheus scraper.
- No replacement of swarm v2 or autonomous checkout authority.
- No `conversation_control_states` mirror table.
- No trigger → priority mapping table.

---

## Deliverables

**Migrations**
- `company_ai_overrides` + `tone_voice_guide`, `escalation_triggers`, `persona_version`
- `company_onboarding_drafts` + `wizard_state`, `step_errors`
- `companies` + `is_live`, `subscription_tier`, `image_gen_unlocked`
- `company_media` + `asset_validation_status`, `validation_reason`
- `company_documents` + `kb_sync_status`, `kb_sync_error`, `kb_synced_at`
- `conversations` + `paused_reason`, `paused_until`
- `meta_credentials` + `connection_state`
- New tables: `test_outbound_log`, `system_metrics`, `outbound_approval_queue`

**Edge functions**
- `embed-document` (trigger-invoked, fire-and-forget)
- `media-upload` resolution + vision validation
- `meta-oauth-state-machine` (poller for Meta-side verification states)
- `_shared/safety-mode-gate.ts` (imported by every dispatcher)
- `is_live` gate added to all outbound dispatchers

**UI**
- Wizard with real Meta state surfacing
- `/admin/sandbox-console`
- `/admin/observability`
- `/admin/media-approvals`
- Conversation control panel using existing `conversations` fields
- KB sync badges on `/setup`

**Docs**
- `OPENCLAW_INTEGRATION.md` — persona cache contract, escalation_triggers prompt format, sandbox/live behaviour, safety-mode tool whitelist, Meta state machine.

---

## Top three risks (your callout, restated)

1. **Meta verification timeline** — start week 1, not week 6.
2. **Token burn** — Section 1 persona cache lands **before** any new MCP tool ships.
3. **Sandbox outbound gating** — Section 5 ships **before** `is_live` defaults flip on real tenants.
