

## Per-agent model assignment + snag elimination — direct providers only

Same goals as before, but **zero Lovable AI Gateway**. We use only the providers we already pay for: **Zhipu (GLM family), Gemini direct, DeepSeek, Kimi (Moonshot)**. The boss-chat / supervisor stays on whatever the company configured.

### Provider menu we'll expose in the UI

Pulled from configured secrets (`ZHIPU_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `KIMI_API_KEY`):

| Model id | Provider | Best for |
|---|---|---|
| `glm-4.7` | Zhipu (direct) | Default workhorse — fast, cheap, strong tool-calls. ANZ baseline. |
| `glm-4.6` | Zhipu (direct) | Slightly cheaper fallback |
| `glm-4.5-air` | Zhipu (direct) | Routing / classification (already used) |
| `glm-5` *(if you confirm endpoint availability on Zhipu OpenAI-compat URL)* | Zhipu | Heaviest reasoning when GLM-5 is GA on `open.bigmodel.cn` — gated behind a feature flag so we don't ship a 404 |
| `gemini-2.5-pro` | Gemini direct | Long context, vision, escalation summaries |
| `gemini-2.5-flash` | Gemini direct | Fast multimodal fallback |
| `deepseek-chat` | DeepSeek | Routing + cheap fallback (already in chain) |
| `deepseek-reasoner` | DeepSeek | Heavy reasoning when low credits / GLM unavailable |
| `kimi-k2-0711-preview` | Moonshot (`api.moonshot.cn`) | Long-context Chinese-style reasoning, very cheap |

We add Kimi as a new provider in `_shared/gemini-client.ts` (`KIMI_OPENAI_URL = https://api.moonshot.cn/v1/chat/completions`) and extend `getProvider()` so any model starting with `kimi-` or `moonshot-` routes there. Existing fallback chain (`primary → glm-4.7 → deepseek-chat`) gets Kimi appended as the final tier.

### Recommended per-agent defaults (configurable per company)

| Agent slug | Default model | Why |
|---|---|---|
| support | `glm-4.7` | Empathetic, fast, cheap |
| sales | `glm-4.7` (Zhipu) — `gemini-2.5-flash` if GLM rate-limits | Strong on the tool chain we use |
| boss / escalation | `gemini-2.5-pro` | Best summary quality for owner notifications |
| router (still global, not per-agent) | `glm-4.5-air` | Already in ANZ baseline |

These are *defaults*; the per-agent dropdown lets each company override.

### Layer 1 — Per-agent model column (DB + UI + runtime)

- Migration: `ALTER TABLE company_agent_modes ADD COLUMN model text NULL;` Backfill `NULL` (means "use company default `primary_model`"). Update `seed_company_agent_modes()` so Boss agent rows get `gemini-2.5-pro` and Support/Sales stay `NULL` (inherit company default).
- `whatsapp-messages/index.ts` line ~2729 — change to:
  ```ts
  const primaryModel = selectedMode?.model || aiOverrides?.primary_model || 'glm-4.7';
  ```
  And include `model` in the select at line ~1886. Log `[AI] Using model=<x> agent=<slug>` so we can verify in production.
- `AgentModeEditor.tsx` — add Model dropdown populated from the menu above with short captions ("Fast & cheap", "Best reasoning", "Long context", etc.). Preserve "Use company default" as the first option (= `NULL`).

### Layer 2 — Kill "I hit a snag" with typed error handling

Replace the catch-all at `whatsapp-messages/index.ts` line ~6816 with `handleAiTurnError(err, ctx)` that classifies and routes:

- **`429` rate-limit** → `geminiChatWithFallback` already exists; ensure the catch path uses it once with `tools` stripped and `temperature=0.7`. If still 429 after fallback chain, send the company's `fallback_message` *and* fire `notify_boss` with `urgent_handoff`. Never the snag string.
- **`402` no credits** on a single provider → fallback chain handles it (next provider in line). Add a one-liner alert into `ai_error_logs` with severity `warning` so admins know to top up that provider.
- **Malformed/truncated JSON** → use a tolerant `repairJson(text)` helper in `_shared/safe-error.ts` (close braces, strip code fences). If repair fails, fall through to fallback chain.
- **Tool-call exception** → wrap each tool execution in its own try/catch (currently only some tools are wrapped). On failure, push a synthetic tool result `{ error: "<tool_name> temporarily unavailable" }` so the model can recover within the same turn instead of throwing the whole loop.
- **Hard timeout** → existing watchdog covers stalls; for true `AbortError`, send `fallback_message` + `notify_boss`. No snag.
- **Anything else** → log to `ai_error_logs` with stack + last-tool context, send `fallback_message`, create boss handoff. Customer never sees the word "snag".

Add `classifyAiError(err): 'rate_limit'|'no_credits'|'timeout'|'malformed'|'tool_failure'|'unknown'` to `_shared/safe-error.ts` and surface counts in `AIErrorTracker.tsx`.

### Layer 3 — Bulletproof handoff (ads-ready)

- Audit `notify_boss` so it always fires **before** the customer-facing fallback message returns (currently sometimes after). One synchronous `await` reorder.
- Retry boss WhatsApp send up to 3× with exponential backoff (1s/3s/8s); on terminal failure, write `severity=critical` row to `ai_error_logs` so it lights up the AI Error Tracker.
- Add a **"Handoff health"** badge in `AdminDashboard` showing 24h handoff success rate + count of failed boss notifications (clickable → AI Error Tracker filtered view).
- Verify boss takeover-number un-pause flow end-to-end (already wired per memory; just confirm).

### Files

- **DB migration** — add `model` column to `company_agent_modes`; update `seed_company_agent_modes()` to set Boss agent default to `gemini-2.5-pro`.
- **`supabase/functions/_shared/gemini-client.ts`** — add Kimi provider (`KIMI_OPENAI_URL`, `kimi-*` routing in `getProvider`), extend fallback chain to include Kimi as final tier, optionally add `glm-5` to chain only if `ZHIPU_GLM5_ENABLED=true` env flag set.
- **`supabase/functions/_shared/safe-error.ts`** — add `classifyAiError` + `repairJson` helpers.
- **`supabase/functions/whatsapp-messages/index.ts`** — use `selectedMode?.model` (line ~2729); include `model` in agent-mode select (~1886); replace catch block (~6816) with `handleAiTurnError`; wrap each tool exec in local try/catch; reorder `notify_boss` to fire pre-fallback.
- **`src/components/admin/deep-settings/AgentModeEditor.tsx`** — add Model dropdown (Zhipu / Gemini / DeepSeek / Kimi options + "Use company default").
- **`src/components/admin/AIErrorTracker.tsx`** — surface new error categories with counts.
- **`src/pages/admin/AdminDashboard.tsx`** — add "Handoff health" badge.
- **`mem://architecture/per-agent-model-assignment.md`** — document the contract: agent.model → company.primary_model → `'glm-4.7'`.
- Update **`mem://configurations/anz-baseline.md`** to include the new per-agent defaults section.

### Validation

1. Set Boss agent → `gemini-2.5-pro` for ANZ in the UI → next boss-routed turn logs `[AI] Using model=gemini-2.5-pro agent=boss`.
2. Mock a 429 from Zhipu → fallback chain hits Gemini direct → reply lands. No snag string in `messages` rows.
3. Mock a malformed JSON response → `repairJson` succeeds → reply lands.
4. Mock a tool throwing → only that tool's result is `{error}`, model still synthesises a customer reply.
5. Force terminal failure (kill all 4 providers in sandbox env) → customer gets `fallback_message`, `notify_boss` fires, AI Error Tracker shows 1 critical row, "Handoff health" badge updates.
6. Tail `whatsapp-messages` logs for 24h post-deploy → grep "I hit a snag" returns zero hits.
7. Cross-check: no string `ai.gateway.lovable.dev` exists in `supabase/functions/_shared/*.ts` after changes.

No frontend routing changes. No RLS changes. No BMS code changes.

