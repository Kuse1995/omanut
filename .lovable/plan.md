
# Omanut Social Swarm — Hierarchical Orchestrator

## Goal
Stop "AI thinks too much in one breath" timeouts. Split a single mega-prompt into 5 focused agents with a scoring loop and a hard retry budget. Roll out safely behind a per-company flag so ANZ keeps its locked baseline until proven.

## Architecture

```text
                    ┌──────────────────────┐
inbound message ──▶ │  swarm-orchestrator  │ (1 edge function, in-process)
                    │      (Overseer)      │
                    └──────────┬───────────┘
                               │ sequential delegations
       ┌───────────────────────┼────────────────────────┐
       ▼               ▼               ▼                ▼
  Gatekeeper      Librarian       Creative         Critic (QA)
  GLM-4.7 t=0.0   GLM-4.7 t=0.1   MiniMax-M2 t=0.7 GLM-4.7 t=0.0
  → IntentObj    → RuleSet        → Draft           → {score, violations, remedy}

  Loop: if score < 8 and retries < 3 → re-call Creative with remedy
        if score ≥ 8 → execute (send WhatsApp / save scheduled post)
        if budget exhausted → escalate to human via notify_boss
```

## Scope (per user choice)

- **Both** `auto-content-creator` and `whatsapp-messages` will be wired to call the new orchestrator.
- Gated by `companies.metadata.swarm_enabled = true`. Default `false`. ANZ stays on current pipeline until flipped.

## Deliverables

### 1. New shared module: `supabase/functions/_shared/swarm/`
- `types.ts` — `IntentObject`, `RuleSet`, `CritiqueReport`, `SwarmRunResult`
- `gatekeeper.ts` — normalizes raw text/voice/media into `IntentObject` (channel, language, intent_type, entities, sentiment)
- `librarian.ts` — pulls company KB + AI overrides + BMS facts relevant to the intent (no full-KB dump; filtered)
- `creative.ts` — drafts response using MiniMax-M2, takes `IntentObject + RuleSet + optional remedy`
- `critic.ts` — GLM-4.7 t=0.0, returns strict JSON `{score:1-10, violations:[], remedy:""}`
- `overseer.ts` — runs the loop, owns retry budget (max 3), writes per-stage timing/scores

### 2. New edge function: `supabase/functions/swarm-orchestrator/index.ts`
- POST entry, `verify_jwt = false`, 60s timeout in `config.toml`
- Body: `{ company_id, channel: 'whatsapp'|'social_post', input, context }`
- Returns: `{ ok, final_text, score, retries, stage_timings, escalated }`

### 3. New table: `swarm_runs`
Audit trail for every loop — stage durations, scores per attempt, final action. Used to compare swarm vs baseline quality over the pilot week.

### 4. Wiring
- `auto-content-creator`: when `swarm_enabled`, replace the single `geminiChat` caption call with `swarm-orchestrator` (channel=`social_post`).
- `whatsapp-messages`: when `swarm_enabled`, route the main reply step through the swarm. Tool execution stays in `whatsapp-messages` (BMS, send_media, etc.) — the swarm only owns *what to say*, not *what to do*. This keeps tool-calling logic centralized and avoids breaking the existing tool-round floors.

### 5. Streaming ack guard
Because the swarm adds ~3-5s vs single-shot, `whatsapp-messages` will send the existing "one moment" ack early when `swarm_enabled` and the loop hasn't returned within 6s. Re-uses `pending-promise-watchdog`.

### 6. Feature flag UI
Add a single toggle in `AIDeepSettings` → "Use Swarm Mode (beta)". Writes to `companies.metadata.swarm_enabled`. No other UI changes.

## Model assignment

| Role       | Model            | Temperature | Why                                          |
|------------|------------------|-------------|----------------------------------------------|
| Gatekeeper | glm-4.7          | 0.0         | Cheap, deterministic normalization           |
| Librarian  | glm-4.7          | 0.1         | Deterministic rule retrieval                 |
| Creative   | MiniMax-M2       | 0.7         | Creative drafting; doubles as MiniMax pilot  |
| Critic     | glm-4.7          | 0.0         | Strict deterministic JSON judge              |
| Overseer   | (no LLM)         | n/a         | Pure code state machine                      |

If MiniMax fails 2x in a run, Creative falls back to glm-4.7 t=0.7 (reuses existing fallback chain in `gemini-client.ts`).

## Loop rules (Critic spec)

Critic MUST return strict JSON:
```json
{ "score": 8, "violations": ["used company name in image prompt"], "remedy": "Rewrite without brand name; tighten to 2 sentences." }
```
- score ≥ 8 → execute
- score 5–7 → retry with remedy injected as system note
- score < 5 → retry with stern remedy ("REJECTED. Critical issues: …")
- 3 failed retries → escalate via existing `notify_boss` contract

## Concurrency / session isolation

Each call is keyed by `(company_id, conversation_id || post_run_id)`. No shared state between calls — orchestrator is stateless, audit goes to `swarm_runs`. This satisfies the "Session Lane" requirement without new infra.

## Out of scope (explicit)

- No OpenClaw `sessions_spawn` integration — runs entirely in our edge function.
- No change to BMS tool layer, Twilio webhooks, Meta webhooks, or boss-chat.
- No model swap for ANZ until owner flips `swarm_enabled`.

## Rollout plan

1. Ship orchestrator + table + flag (default off).
2. Enable on one test company, watch `swarm_runs` for 24h.
3. Compare avg score, retry rate, latency vs baseline `whatsapp_messages` logs.
4. Enable on ANZ only after 3 days of clean metrics.

## Files touched

**New:**
- `supabase/functions/_shared/swarm/{types,gatekeeper,librarian,creative,critic,overseer}.ts`
- `supabase/functions/swarm-orchestrator/index.ts`
- migration: `swarm_runs` table + RLS

**Modified:**
- `supabase/config.toml` — register `swarm-orchestrator`
- `supabase/functions/auto-content-creator/index.ts` — flag-gated swarm call
- `supabase/functions/whatsapp-messages/index.ts` — flag-gated swarm call for reply text
- `src/components/admin/deep-settings/ModelConfigPanel.tsx` (or AIDeepSettings) — Swarm Mode toggle

## Risk notes

- Latency: +3-5s per reply when enabled. Mitigated by early ack.
- Cost: ~2-3x tokens per reply (4 LLM calls vs 1). Acceptable for quality gate; Critic is cheap GLM.
- MiniMax unproven for tool-aware drafting: Creative does NOT call tools, only drafts text given retrieved facts → low risk surface.
