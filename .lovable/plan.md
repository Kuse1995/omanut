## Goal
Make **MiniMax-M2** (latest text/tool-calling model from MiniMax — the closest match to your "MiniMax 2.7" ask; their current GA text model is `MiniMax-M2`) the **primary brain** for all major tool-calling and response generation across the system, with GLM-4.7 demoted to fallback only.

> ⚠️ Quick check before I build: MiniMax has not yet released a public model literally named `MiniMax-M2.7`. Their current latest text+tool-calling model is `MiniMax-M2`. I'll proceed with `MiniMax-M2` as the canonical name and make the model id a single constant so we can swap to `MiniMax-M2.7` later by changing one line. If you have an exact model id you've been given by MiniMax (e.g. preview SKU), drop it in chat and I'll use it.

## Scope — what gets switched to MiniMax

**Switched to MiniMax-M2 (primary)**
1. `whatsapp-messages` — main router + tool-calling loop (the agent that calls `check_stock`, `list_products`, `notify_boss`, reservations, etc.). Both call sites at lines 1841 and 2911-2914.
2. `boss-chat` — owner chat tool-calling loop (line 1302).
3. `swarm/creative.ts` — already on MiniMax-M2, leave as-is.
4. `swarm/critic.ts` (lines 25, 89) and `swarm/gatekeeper.ts` (line 23) — switch to MiniMax-M2 so the **whole swarm runs on one provider** (eliminates cross-provider latency variance the user flagged).
5. `supervisor-agent` (line 174), `analyze-and-followup` (line 292), `generate-reply-draft` (line 257) — primary response generation.
6. `auto-content-creator` (line 205) — social post drafts.
7. `ai-playground` default (line 73).
8. Default `companies.ai_overrides.primary_model` for **new** companies (seed) → `MiniMax-M2`.

**NOT switched (kept on current model)**
- `whatsapp-image-gen`, `extract-product-identity`, `analyze-customer-image`, `analyze-reference-image`, `analyze-media`, `index-brand-asset`, `reindex-company-media` — all multimodal vision tasks. MiniMax-M2 is text-only; vision stays on `glm-4.7` / `gemini-2.5-flash`.
- `research-company`, `smart-configure`, `meta-lead-alert`, `analyze-conversation`, `ai-training-coach`, `daily-briefing`, `analyze-ai-quality`, `extract-product-identity` — low-volume admin/analytics jobs. Leave on `glm-4.7` to avoid burning MiniMax quota for non-customer-facing work.
- Embeddings (`embedding-client.ts`) — Gemini, unchanged.
- Image generation (`gpt-image-1`, `gemini-2.5-flash-image`) — unchanged.

## How — single switch, safe rollout

### 1. New constant in `_shared/gemini-client.ts`
```ts
export const PRIMARY_TEXT_MODEL = Deno.env.get('PRIMARY_TEXT_MODEL') || 'MiniMax-M2';
export const FALLBACK_TEXT_MODEL = 'glm-4.7';
```
One env var (`PRIMARY_TEXT_MODEL`) lets us flip back to `glm-4.7` without redeploying if MiniMax has an outage.

### 2. Update fallback chain
Reorder `geminiChatWithFallback` so MiniMax is **always first**, GLM second, Gemini third, DeepSeek/Kimi tail. Remove the existing `MINIMAX_AS_PRIMARY` env gate (becomes default).

```
chain = [PRIMARY_TEXT_MODEL, 'glm-4.7', 'gemini-2.5-flash', 'deepseek-chat', 'kimi-k2-0711-preview']
```

### 3. Replace inline `'glm-4.7'` / `'google/gemini-2.5-flash'` literals
In the 8 files listed under "Switched", swap the hard-coded string for `PRIMARY_TEXT_MODEL` (or the override expression `aiOverrides?.primary_model || PRIMARY_TEXT_MODEL`).

### 4. Tool-calling compatibility validation (critical)
MiniMax-M2 supports OpenAI-compatible `tools` + `tool_choice`. The current `whatsapp-messages` and `boss-chat` payloads already match that schema (`tools: filteredTools, tool_choice: "auto"`). I'll add one defensive normalization:
- MiniMax requires `tool_call_id` echoed back in `role:"tool"` messages (already done in our loops — verified).
- MiniMax rejects `parameters: {}` for zero-arg tools — coerce to `{type:"object", properties:{}}` if any tool is missing it (cheap one-liner in the geminiChat wrapper, MiniMax branch only).

### 5. Per-company override preserved
`companies.ai_overrides.primary_model` still wins. Existing companies with explicit GLM stay on GLM; new companies get MiniMax via seed default.

### 6. Rollout
- Ship with `PRIMARY_TEXT_MODEL=MiniMax-M2` env var unset → reads default `MiniMax-M2`.
- Watch for 1 hour:
  - `swarm_runs.bypass_reason` for `'budget_exhausted'` spikes
  - `whatsapp-messages` logs for `[AI-FALLBACK] Model MiniMax-M2 failed` patterns
  - Tool-call success rate (no malformed `tool_calls` arrays)
- If MiniMax misbehaves, set workspace secret `PRIMARY_TEXT_MODEL=glm-4.7` → instant rollback, no code change.

## Out of scope
- Vision pipelines (kept on GLM/Gemini)
- Voice (Realtime stays on its current model)
- Embeddings
- Image / video generation
- Changing the swarm post-hoc refinement architecture (already shipped)
- Re-pointing existing companies that have a non-default `primary_model` set

## Files I'll edit
- `supabase/functions/_shared/gemini-client.ts` (constants + fallback reorder + MiniMax tool-schema coerce)
- `supabase/functions/whatsapp-messages/index.ts` (2 model literals)
- `supabase/functions/boss-chat/index.ts` (1 default literal)
- `supabase/functions/_shared/swarm/{gatekeeper,critic}.ts` (model literals)
- `supabase/functions/{supervisor-agent,analyze-and-followup,generate-reply-draft,auto-content-creator,ai-playground}/index.ts` (model literals)
- New migration: update default JSONB for `companies.ai_overrides->>primary_model` for newly-seeded companies (does NOT touch existing rows)
- `mem://index.md` — add a Core line: "Primary text/tool-calling model: MiniMax-M2 (override via PRIMARY_TEXT_MODEL env)"

Approve and I'll ship it. If you want me to also flip *existing* companies (not just new ones) over to MiniMax in the same migration, say so — otherwise I leave their `ai_overrides.primary_model` untouched.