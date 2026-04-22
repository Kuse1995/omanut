

## Remove Lovable AI Gateway entirely

You're right — the system has its own provider keys (Zhipu/`glm-4.7`, DeepSeek, Gemini direct). Routing through the Lovable AI Gateway is just burning credits unnecessarily. Rip it out.

### What's currently using Lovable AI Gateway

From `_shared/gemini-client.ts` and recent edits, the gateway (`https://ai.gateway.lovable.dev/...` + `LOVABLE_API_KEY`) is used as:
1. The **fallback path** when `ZHIPU_API_KEY` is missing for `glm-4.7`-class models.
2. The **provider** for any `google/gemini-*` model name (after the `zai/` normalization fix).
3. Possibly inside `supervisor-agent` after we switched it to `google/gemini-2.5-flash`.

### Fix

#### 1. Strip every Lovable Gateway call site
- `supabase/functions/_shared/gemini-client.ts`: remove all `ai.gateway.lovable.dev` URLs and any branch that uses `LOVABLE_API_KEY`. Replace with direct provider calls only:
  - `glm-*`, `zhipu/*`, `zai/*` → Zhipu API (`https://open.bigmodel.cn/api/paas/v4/chat/completions`) using `ZHIPU_API_KEY`.
  - `google/gemini-*` → Google Generative Language API directly using `GEMINI_API_KEY`.
  - `deepseek/*` → DeepSeek API using `DEEPSEEK_API_KEY`.
- Audit every other edge function that touches the gateway and replace with the matching provider call. Likely candidates: `supervisor-agent`, `analyze-conversation`, `analyze-and-followup`, `boss-chat`, `ai-playground`, `smart-configure`, `auto-content-creator`, `ai-training-coach`, anything importing `gemini-client`.

#### 2. Remove the gateway as a fallback target
The current "transparent fallback to Lovable Gateway when Zhipu key missing" logic must be deleted. New behavior when a provider key is missing:
- log a clear `[CONFIG-ERROR] Missing <PROVIDER>_API_KEY for model <name>`
- fall back to a different **direct** provider the system already has a key for (e.g. Zhipu → Gemini direct → DeepSeek), in that order
- if no direct provider keys are configured, return a clean error and escalate via `notify_boss` rather than silently calling the gateway

#### 3. Pin ANZ to a directly-keyed model
- Set `company_ai_overrides.primary_model` for ANZ to `glm-4.7` (Zhipu, working today).
- Set fallback chain to `glm-4.7 → google/gemini-2.5-flash (direct) → deepseek/deepseek-chat (direct)` — none of these touch the gateway.

#### 4. Remove `LOVABLE_API_KEY` references
- Remove from any `Deno.env.get("LOVABLE_API_KEY")` call.
- Don't delete the secret itself (it's auto-managed); just stop reading it.

#### 5. Update memory
- `mem://configurations/anz-baseline.md`: model is `glm-4.7` via Zhipu direct, no gateway.
- Add a Core rule to `mem://index.md`: "Never call the Lovable AI Gateway. Use direct provider APIs (Zhipu, Gemini, DeepSeek) only."

### Validation

- `grep -r "ai.gateway.lovable.dev\|LOVABLE_API_KEY" supabase/functions` returns **zero** matches.
- Send "what's in stock?" to ANZ → answers via `glm-4.7` (Zhipu direct), no gateway in logs.
- Force ANZ to use `google/gemini-2.5-flash` → calls `generativelanguage.googleapis.com` directly with `GEMINI_API_KEY`.

### Required secrets (confirm before implementing)

The replacement only works if these provider keys exist:
- `ZHIPU_API_KEY` — for `glm-*` (you have this — it's why glm-4.7 works today)
- `GEMINI_API_KEY` — for `google/gemini-*` direct
- `DEEPSEEK_API_KEY` — for `deepseek/*` direct (currently out of credit but key exists)

If `GEMINI_API_KEY` is missing, I'll request it via the secrets flow before touching code, otherwise removing the gateway will break any company configured for Gemini.

### Files

- `supabase/functions/_shared/gemini-client.ts` — full rewrite of provider routing, no gateway.
- All edge functions importing `gemini-client` — no API change needed if the client interface stays the same.
- `supabase/functions/supervisor-agent/index.ts` — confirm it uses the cleaned client, not a direct gateway fetch.
- DB migration — pin ANZ model + fallback chain to direct-provider models.
- `mem://index.md` + `mem://configurations/anz-baseline.md` — record the rule.

No schema changes, no UI changes, no new tools.

