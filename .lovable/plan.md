# Fix: Router Always Lands on Customer Care

## What's broken

The intent router in `whatsapp-messages` calls a reasoning-tier LLM (GLM‑4.5‑Air / similar) with `max_tokens: 150`. These models spend their entire budget inside `reasoning_content` and return an **empty** `message.content` with `finish_reason: "length"`. Our code reads only `content`, sees empty, throws `"Router provider returned no choices"`, and falls into the keyword/`is_default` fallback. Because the seeded default is **support** (priority 20, `is_default = true`), every conversation gets pinned to Customer Care — regardless of what the customer said.

Evidence:
- `agent_performance`: 15/15 most recent rows = `support`, confidence `0.4`, reason `"Default mode (no keyword match)"` (the catch-block string).
- Edge logs: `[ROUTER] Provider returned no choices, payload shape: {"choices":[{"finish_reason":"length","message":{"content":"","reasoning_content":"…"}}]}`.

## Fix (3 small, surgical changes)

### 1. `supabase/functions/whatsapp-messages/index.ts` — `routeToAgent()`

- **Raise `max_tokens`** from `150` → `400` so reasoning models have room to emit JSON after their internal thoughts.
- **Read `reasoning_content` as a secondary source.** When `content` is empty, scan `reasoning_content` for the first `{...}` block and parse that. Many GLM/DeepSeek reasoning replies embed the final JSON inside the reasoning trail.
- **Add a strict-mode hint** to the system message: `"Output ONLY a JSON object on the first line. Do not think out loud."` — cuts reasoning length on models that honor it.
- **Pin the router default to a non-reasoning model.** Change the inline default from `'deepseek-chat'` to `'google/gemini-2.5-flash-lite'` (fast, cheap, non-reasoning, reliable JSON). `aiOverrides.routing_model` still wins when set.

### 2. `supabase/migrations/<new>.sql`

- Update existing `company_ai_overrides.routing_model` rows that are currently set to a reasoning model (`glm-4.5-air`, `glm-4.6`, `deepseek-reasoner`, anything ending in `-thinking`/`-reasoning`) → `google/gemini-2.5-flash-lite`.
- Update the `seed_company_ai_overrides()` trigger so new companies start with `routing_model = 'google/gemini-2.5-flash-lite'` (today it's `'MiniMax-M2'`, which is also a reasoning-tier model and would reproduce the same bug).

### 3. Observability (tiny)

- In the catch block, log the **actual error string** at `console.error` and write `notes = "Router exception: <err>"` instead of the misleading `"Default mode (no keyword match)"`. This way, future failures are diagnosable from `agent_performance` alone without grepping edge logs.

## Out of scope

- No changes to swarm, tool-calling loop, prompts, or the primary text model (`MiniMax-M2` stays as the response brain — it's only the **router** that needs a deterministic JSON model).
- No UI changes.
- Not changing `is_default = support` in `company_agent_modes` — that's a sensible safety net once the router actually works.

## Validation

1. Deploy → send a test WhatsApp message like "How much is the premium package?".
2. Check `agent_performance`: expect `agent_type = sales`, `confidence ≥ 0.7`, reason mentioning pricing/buy intent.
3. Send "this is broken, help" → expect `support`.
4. Tail edge logs for `[ROUTER] ✓ Selected:` lines with non-`0.4` confidences.
5. Confirm no rows with `notes = "Default mode (no keyword match)"` accumulate after deploy.
