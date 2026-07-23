## Goal
Switch the primary text/tool-calling brain from `kimi-k2-thinking` to `kimi-k3` (Moonshot Kimi K3 flagship) across every edge function, and adapt the shared client to K3's stricter request contract so it doesn't 400 on the fixed params K3 rejects.

## Changes

### 1. `supabase/functions/_shared/gemini-client.ts`
- Set `PRIMARY_TEXT_MODEL` default to `kimi-k3` (still overridable via env for instant rollback).
- Set `FALLBACK_TEXT_MODEL` default to `kimi-k2-thinking`.
- For the `kimi` provider branch, when `modelToSend === 'kimi-k3'` build the request body per K3 contract:
  - Strip `temperature`, `top_p`, `presence_penalty`, `frequency_penalty`, `n` (K3 fixes these; sending them errors).
  - Convert `max_tokens` → `max_completion_tokens` (default 131072, cap at 1,048,576).
  - Pass through `reasoning_effort` when caller supplies it; default `low` for latency-sensitive callers (boss-chat / whatsapp-messages) via a new optional `reasoningEffort` option on `GeminiChatOptions`.
  - Tool calling: keep as-is (K3 supports OpenAI-compatible `tools` + `tool_choice`).
- Reorder `fallbackChain` in `geminiChatWithFallback`: `kimi-k3` → `kimi-k2-thinking` → `kimi-k2-turbo-preview` → `kimi-k2-0711-preview` → `glm-4.6` → `gemini-2.5-flash` → `deepseek-chat`.
- Keep Moonshot base URL `api.moonshot.cn` (already working with current `KIMI_API_KEY`); K3 is served on the same endpoint per Moonshot's OpenAI-compatible surface.

### 2. Database — swap saved company overrides
Update `public.company_ai_overrides` rows where `primary_model IN ('kimi-k2-thinking','kimi-k2-0711-preview','glm-5.2','glm-4.7','MiniMax-M2')` to `primary_model = 'kimi-k3'` so per-company settings match the new default.

### 3. Verification
- `curl_edge_functions` → `boss-chat` for OmanutBMS to confirm K3 responds.
- `curl_edge_functions` → `whatsapp-messages` with a synthetic inbound to confirm tool-calling (notify_boss / handoff) still fires under K3.
- Check `edge_function_logs` for any `400` from Moonshot on rejected params; if seen, tighten the K3 body-shaping branch.

## No changes to
- `KIMI_API_KEY` secret (already set).
- OpenClaw pull loop, MCP server, image-gen paths.
- Handoff / supervisor logic (already fixed in prior turn).

## Rollback
Set env `PRIMARY_TEXT_MODEL=kimi-k2-thinking` on the project; no redeploy needed since the client reads it at cold start.