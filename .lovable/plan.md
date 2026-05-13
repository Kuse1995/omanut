# Swarm v2: Async Dispatch + Latency Kill-Switch + Channel-Aware Profiles

Adopting the four recommendations without breaking the existing sync path. Everything is gated so we can roll back per-company.

## 1. Async dispatch for WhatsApp (fix the real timeout)

**Problem:** `whatsapp-messages` already replies inside Twilio's webhook window. Adding the swarm refinement pass on top pushes us over 10s and triggers the fallback.

**Fix:** When `swarm_enabled = true` AND channel = whatsapp, do NOT block the webhook on the swarm. Instead:

1. `whatsapp-messages` runs the **fast path** as today (router → tools → first draft) and ships it immediately. This keeps the customer-visible reply under ~3s.
2. After sending, it fires `swarm-orchestrator` via `supabase.functions.invoke(..., { body: {..., mode: 'post_hoc_refine'} })` *without awaiting*.
3. The orchestrator runs the full Critic loop in the background. If the critic's final draft differs materially from the draft we already sent (score delta ≥ 3 OR violations include a hard rule), it sends a **follow-up correction message** via `send-whatsapp` and logs the divergence to `swarm_runs.notes`.
4. For >95% of replies the critic will agree → no follow-up, zero user-visible latency cost. We get the QA signal without paying the timeout.

Social posts (`auto-content-creator`) stay **sync** — there's no webhook timeout pressure there and quality matters more than latency.

## 2. Circuit breaker inside the Overseer

Add to `_shared/swarm/overseer.ts`:

- Track `total_ms` from start of `runSwarm`.
- Hard ceiling: `SWARM_BUDGET_MS = 12000` for whatsapp, `25000` for social_post.
- Before each Creative→Critic attempt, check remaining budget. If `< 4000ms`, skip further retries:
  - Run a single "safety-only" critic pass (banned topics + hallucinated facts) on the best draft so far.
  - If safety passes → ship best draft, mark `escalated=true`, `bypass_reason='budget_exhausted'`.
  - If safety fails → return `null` and let the caller use its existing fallback.
- Log every bypass to `swarm_runs.notes->>'bypass'` for the admin dashboard.

## 3. "Lite" swarm profile per channel

New field on `SwarmInput`: `profile?: 'full' | 'lite' | 'safety_only'` (default `'full'`).

Channel defaults inside `swarm-orchestrator`:
- `social_post` → `full` (Gatekeeper + Librarian + Creative + Critic loop, max 3 retries)
- `meta_comment` → `full` (public-facing, brand risk)
- `meta_dm` → `lite`
- `whatsapp` (post-hoc refine) → `lite`

`lite` = Gatekeeper + Creative + **single** Critic pass (no retry loop). Critic is upgraded to `full` only when:
- intent.sentiment ∈ {`negative`, `urgent`}, OR
- entities indicate high-value (price > company-defined threshold), OR
- intent.intent_type ∈ {`complaint`, `refund`, `legal`, `escalation`}.

This implements the "Critic only when angry or high value" rule.

## 4. BMS Librarian cache (already 80% there — just enforce it)

Memory `BMS Auto-Sync` confirms `bms-auto-sync-cron` already refreshes `companies.quick_reference_info` every 15 min, and `librarian.ts` already reads that block. No new table needed.

What we add:
- **Hard rule in Librarian**: never call `bms-tools` directly during swarm. Only read the cached BMS block.
- If the Librarian detects an entity not present in the cached block, it sets `intent.entities.bms_miss = true` and the Creative must reply with a "let me check and follow up" template instead of stalling on a live API call. The actual BMS lookup happens out-of-band by `whatsapp-messages` tool path (where it already lives), not in the swarm.
- Surface a per-company metric: `bms_cache_hit_rate` on `swarm_runs` aggregations.

## 5. Twilio media URL pre-signing (out of swarm scope, but on the list)

Memory `Twilio Media Authentication Requirement` already requires auth headers. Quick-win: when `whatsapp-messages` ingests `MediaUrl*`, immediately copy the asset to the `conversation-media` Supabase bucket and store the public URL on the message row. Downstream AI/vision calls use the bucket URL — no Twilio auth retries, no expiry. This is a small change in the inbound handler, independent of the swarm work.

## Files to change

```text
supabase/functions/_shared/swarm/types.ts
  + SwarmProfile type, SWARM_BUDGET_MS constants, profile field on SwarmInput

supabase/functions/_shared/swarm/overseer.ts
  + budget tracking, circuit breaker, profile-aware loop (lite skips retries)
  + safety-only critic pass on bypass

supabase/functions/_shared/swarm/critic.ts
  + safetyOnly() variant (banned topics + fact check only, no scoring loop)

supabase/functions/_shared/swarm/librarian.ts
  + bms_miss detection, never call live BMS

supabase/functions/swarm-orchestrator/index.ts
  + accept mode: 'post_hoc_refine'
  + channel→profile defaulting
  + when post_hoc_refine, compare to body.already_sent_text and only emit follow-up
    if material divergence; call send-whatsapp directly for the correction

supabase/functions/whatsapp-messages/index.ts
  - REMOVE: blocking refinement pass added in swarm v1
  + AFTER reply is sent: fire-and-forget invoke of swarm-orchestrator with
    { mode: 'post_hoc_refine', already_sent_text, conversation_id, ... }

supabase/migrations/<new>.sql
  + ALTER TABLE swarm_runs ADD COLUMN profile text, bypass_reason text,
    bms_cache_hit boolean, divergence_score int

src/components/admin/deep-settings/SwarmModeToggler.tsx
  + show new metrics: avg total_ms, bypass rate, divergence rate, bms cache hit
```

## What stays the same

- Existing `swarm_enabled` flag and per-company gating.
- `auto-content-creator` integration (full sync swarm — quality matters, no timeout).
- All BMS tools, Twilio paths, boss-chat, OpenClaw — untouched.
- ANZ stays on `swarm_enabled = false` until we see 72h of clean v2 metrics on the test company.

## Rollout

1. Ship migration + code with flag still off everywhere.
2. Enable on one low-volume test company. Watch `swarm_runs` for 24h:
   - p95 `total_ms` < 8s on whatsapp post-hoc
   - bypass rate < 15%
   - divergence rate < 10% (most replies need no correction)
3. If green → enable ANZ. If divergence rate > 25%, the fast path is too weak and we tighten its prompt before re-enabling refine.

## Out of scope for this plan

- Moving to a real queue (Inngest) — async dispatch via `functions.invoke` without await is sufficient for current volume; revisit if we exceed ~5 req/s sustained.
- Pre-signing Twilio media URLs (called out in §5 but tracked as a separate change so this plan stays focused on swarm latency).
- ANZ model swap or any agent-mode prompt changes.
