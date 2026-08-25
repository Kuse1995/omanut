# omanut-harness — External LLM Decision Layer for Omanut

> **Status: PROPOSED (kill switch defaults to `off` — zero behavior change until a company opts in).**
> Mirrors the proven `bms-harness` pattern (the DeepSeek router that made the BMS
> WhatsApp bot reliable) applied to the Omanut automation platform.

## 1. Why

The in-house WhatsApp brain (MiniMax/DeepSeek via `_shared/gemini-client.ts`) has
been the source of reliability pain: slow turns, quota errors, and quality drift.
The BMS bot solved this by moving the LLM decision to a small, zero-dependency,
guardrailed harness on the farm (`bms-harness.omanut.online`). We replicate that
for Omanut: **`omanut-harness`** — same farm, same zero-dep pattern, same
server-enforced guardrails, same caller-side kill switch.

## 2. Architecture

```
Customer ──► Twilio ──► whatsapp-messages (edge fn)
                              │
              harness_mode = off|pilot|on (per company, metadata)
                              │ (pilot: only harness_pilot_phones)
                              ▼
                    omanut-harness.omanut.online
                    POST /whatsapp/turn  (Bearer HARNESS_API_KEY)
                              │
                         DeepSeek (deepseek-chat)
                              │
                    OpenAI-shaped response (content + tool_calls)
                              │
              ┌───────────────┴───────────────┐
              │ ok                            │ any non-200 / timeout / error
              ▼                               ▼
   existing tool executors            in-house pipeline
   (check_stock, notify_boss,         (geminiChatWithFallback +
    request_payment, ...)              existing loop) — UNCHANGED
```

**Key design decisions:**

1. **Drop-in LLM replacement, not a fork.** The harness returns the same
   OpenAI-shaped wire format (`choices[0].message` with `content` + `tool_calls`)
   the in-house client returns. whatsapp-messages' existing multi-round tool
   loop, executors, Twilio sends, and persistence are **untouched** — only
   *who decides* changes. This keeps the blast radius tiny and the rollback
   instant (flip `harness_mode` back to `off`).
2. **Kill switch is per company, default off.** `companies.metadata.harness_mode`
   (`off` | `pilot` | `on`) + `harness_pilot_phones`. No company is affected
   until it opts in. Pilot = only listed phones hit the harness.
3. **Never fail-open, never double-reply.** On ANY harness non-200/timeout/network
   error the caller falls straight through to the in-house pipeline. The harness
   has no send capability at all — it can only advise.
4. **Server-enforced guardrails** (not prompt-only):
   - **Price guard**: a customer-facing reply may only quote money digits already
     present in the input (message + history + context) → else 502
     `llm_price_invention` and the caller falls back in-house.
   - **Tool-name guard**: proposed `tool_calls` names must exist in the tools the
     caller attached; hallucinated names are dropped (logged `ng`).
   - Reply cap (`MAX_REPLY_CHARS`), history/context caps, body cap.
5. **Content-free observability.** Turn log stores hashed session id, message
   length, history count, latency, status, tool names — **never message content**.
   Correlate with whatsapp-messages by timestamp + length (same method as BMS).
6. **The caller's system prompt wins.** whatsapp-messages sends its fully-assembled
   prompt (`instructions` — persona, KB, brand voice, sales mode, tool rules) as
   `body.system`; the harness forwards it verbatim. All the prompt engineering
   stays in ONE place.

## 3. Contract

`POST /whatsapp/turn`, header `Authorization: Bearer <HARNESS_API_KEY>`

Request (messages-array form — used by the tool loop):
```json
{
  "session_id": "<company_id>:<phone>",
  "messages": [
    {"role": "system", "content": "<whatsapp-messages instructions — persona, KB, rules>"},
    {"role": "user", "content": "do you have mealie meal?"},
    {"role": "assistant", "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "check_stock", "arguments": "{\"product_name\":\"mealie meal\"}"}}]},
    {"role": "tool", "tool_call_id": "call_1", "content": "{\"success\":true,...}"}
  ],
  "tools": [{"type": "function", "function": {"name": "check_stock", "description": "..."}}]
}
```

Response 200 (OpenAI-shaped):
```json
{ "ok": true, "choices": [{ "message": { "role": "assistant",
  "content": "Mealie meal 25kg is K350. We have 40 in stock.",
  "tool_calls": [...] } }] }
```

Errors (caller MUST fall back to in-house on ANY non-200):
- `401 unauthorized` · `400 bad_message/bad_json/bad_body`
- `502 llm_failed` (retry once on network/5xx) · `502 llm_price_invention`
- `503 not_configured` (no DEEPSEEK_API_KEY on the farm)

## 4. Files

### New: harness (farm — zero npm deps, node:http only)
`hell/outputs/omanut-harness/` (local mirror; deploy via farm-deploy.sh):
- `src/server.js` — contract, guardrails (price guard, tool-name guard, caps), turn log
- `src/deepseek.js` — SYSTEM_PROMPT (fallback persona; caller system wins) + client
- `src/config.js`, `src/index.js`, `src/logger.js`, `scripts/healthcheck.js`
- `data/omanut-harness-test.js` — **28/28 checks** (fake DeepSeek in-process)
- `.env.example`, `README.md`

Farm service: `omanut-harness.service`, port `3003`,
`https://omanut-harness.omanut.online` (Caddy wildcard `*.omanut.online` already
exists). Add via `/root/farm/add-harness.sh omanut-harness "omanut-harness.omanut.online" 3003`.

### New: edge-side client
`supabase/functions/_shared/harness-client.ts`:
- `isHarnessEnabled(metadata, phone)` — off|pilot|on + pilot phone list
- `callHarness({session_id, messages, tools, max_tokens, temperature})` —
  returns `{ok, message?}`; **never throws**; `ok:false` on any failure.

### Modified: `whatsapp-messages/index.ts`
- Import `isHarnessEnabled, callHarness`.
- Compute `harnessEnabled` once per turn (after company load).
- **Main call site**: if harnessEnabled → callHarness first; fall through to
  `geminiChatWithFallback` on failure.
- **Tool-loop round call**: same — callHarness first; fall back to `geminiChat`.
- Retry paths (catch block) intentionally stay in-house (error recovery, belt-and-braces).
- `generateConversationSummary` / boss draft generation stay in-house (boss-side assist).

## 5. Rollout plan (no-risk, phased)

1. **Build + test locally**: harness 28/28; `node --check` all files; whatsapp-messages
   tsc-clean apart from pre-existing Deno/remote-import noise. ← *current state*
2. **Deploy harness to farm** (needs Abraham): `farm-deploy.sh omanut-harness 3003`,
   add-harness.sh, healthcheck cron, `HARNESS_API_KEY` + `DEEPSEEK_API_KEY` in
   farm .env (chmod 600). Verify `/health` → `deepseekConfigured: true`.
3. **Set env on Supabase**: `OMANUT_HARNESS_URL`,
   `OMANUT_HARNESS_API_KEY` (edge function secrets).
4. **Pilot**: set `companies.metadata.harness_mode = 'pilot'` +
   `harness_pilot_phones = ['+260...']` (boss's test line) for the OmanutBMS
   company. Test end-to-end on the boss line only.
5. **Widen**: `harness_mode = 'on'` for OmanutBMS company; watch
   `get_ai_errors` (zero new `ai_call_failed` expected) and harness turn log.
6. **Onboard more tenants** one at a time.

## 6. What must NOT be done

- Do not run a second brain concurrently for the same conversation (double-reply).
- Do not weaken the price guard or tool-name guard — they are load-bearing
  (same rule as bms-harness).
- Do not store message content in harness logs.
- Do not let the harness send anything — it advises only.

## 7. Verification after pilot

- [ ] Harness `/health` → `deepseekConfigured: true`
- [ ] A real WhatsApp turn on the pilot line answered by harness (log line
  `[HARNESS] main turn answered by harness`)
- [ ] Kill-switch rollback test: flip `harness_mode` to `off`, next turn answered
  in-house
- [ ] `get_ai_errors` shows zero new `ai_call_failed` for the pilot company
- [ ] Price guard verified: ask "how much is X?" with a price NOT in KB → harness
  502 → in-house fallback (or honest "let me check") — never an invented price
