## Why
Logs show the silent timeout is caused by **DeepSeek returning HTTP 200 + body `"Insufficient Balance"`** during router classification. Zhipu/GLM happens to be funded today, so the main reply still went through — but the same error from any provider in the chain produces no customer reply at all. Today's chain is: **primary → glm-4.7 → gemini-2.5-flash → deepseek-chat → kimi-k2**. No MiniMax. The router itself uses a hardcoded `deepseek-chat` with no fallback.

## What we'll add
Wire MiniMax's text/chat endpoint as a first-class provider in `_shared/gemini-client.ts`, slot it into the fallback chain, and give the router the same fallback so a single provider's billing failure can never silence the AI again.

## Changes

**1. `supabase/functions/_shared/gemini-client.ts`**
- Add `MINIMAX_OPENAI_URL = 'https://api.minimax.io/v1/text/chatcompletion_v2'`.
- Extend `getProvider()` and `normalizeModel()` to recognize `minimax/`, `minimax-`, and `MiniMax-*` model names → route to `'minimax'`.
- Add a `case 'minimax'` branch in `geminiChat()` that reads `MINIMAX_API_KEY` (already present in this project from the video client) and POSTs OpenAI-compatible chat completions.
- Update `geminiChatWithFallback()` chain to:
  ```
  options.model
  → glm-4.7
  → MiniMax-M2          ← new (latest text model on the $10 plan)
  → gemini-2.5-flash
  → deepseek-chat
  → kimi-k2-0711-preview
  ```
- **Critical fix:** treat HTTP 200 + body containing `"Insufficient Balance"` / `"insufficient_quota"` / `"payment required"` as a failure inside the loop so the chain advances instead of returning a "successful" empty reply.

**2. `supabase/functions/whatsapp-messages/index.ts` — router fix**
- The router currently calls DeepSeek directly with no fallback (line 801). Replace that branch with `geminiChatWithFallback({ model: routingModel, ... })` so the same provider chain protects intent classification. Keep the same response-shape parsing.

**3. Optional default switch (off by default)**
- Add a `MINIMAX_AS_PRIMARY=true` env switch. When set, the chain reorders so `MiniMax-M2` is tried first. Off by default — opt in once you've verified quality on real traffic.

**4. `mem://index.md` Core rule update**
- Append `minimax/MiniMax-*` to the allowed direct-provider list alongside Zhipu/Gemini/DeepSeek/Kimi. Still no Lovable AI Gateway.

## Verification
- Deploy the two edge functions, then send a WhatsApp to Omanut Technologies.
- Logs should show `[AI-FALLBACK] Trying model … MiniMax-M2` whenever an upstream provider is dry, and `[AI-FALLBACK] Success with model: MiniMax-M2` instead of the silent "no choices" error.
- Force-test: temporarily rename `DEEPSEEK_API_KEY` in secrets and confirm the router still classifies and the customer still gets a reply.

## Out of scope (separate follow-ups)
- Boss alert when billing balance hits zero on any provider.
- Generic "graceful customer fallback" message — `sendFallbackToCustomer` already exists; only the watchdog wiring would change.
- Topping up DeepSeek (manual, your side).

## Secrets needed
- `MINIMAX_API_KEY` is already present (used by the video client). Same key works for text — no new secret needed.
