

# Migrate Remaining Edge Functions from Lovable AI Gateway to Direct Gemini API

## Problem
You already migrated most functions to use the shared `gemini-client.ts` (which calls Gemini directly via `GEMINI_API_KEY`), but two functions still call `ai.gateway.lovable.dev` with `LOVABLE_API_KEY` -- which is why you're hitting 402 "not enough credits" errors.

## Functions Still Using Lovable Gateway

| Function | Locations | Description |
|----------|-----------|-------------|
| `whatsapp-messages/index.ts` | 4 `fetch()` calls (lines ~220, ~765, ~1860, ~3061) | Main WhatsApp handler -- routing, drafts, AI reply, tool follow-up |
| `demo-session/index.ts` | 1 `fetch()` call (line ~668) | Demo session AI |

**Already migrated** (no changes needed): `boss-chat`, `meta-webhook`, `research-company`, `ai-playground`, `supervisor-agent`, and 13 others.

## Changes

### 1. `supabase/functions/whatsapp-messages/index.ts`

- Add `import { geminiChat } from "../_shared/gemini-client.ts";` at the top
- Replace all 4 direct `fetch('https://ai.gateway.lovable.dev/...')` calls with `geminiChat()`:
  - **Line ~220** (routeToAgent fallback): Replace Lovable gateway fetch with `geminiChat({ model: routingModel, messages, temperature, max_tokens })`
  - **Line ~765** (draft generation): Replace with `geminiChat({ model, messages, temperature, max_tokens })`
  - **Line ~1860** (main AI reply): Replace with `geminiChat({ model: selectedModel, messages, temperature, max_tokens, tools, tool_choice })` 
  - **Line ~3061** (tool follow-up): Replace with `geminiChat({ model: selectedModel, messages, temperature, max_tokens })`
- Remove the `LOVABLE_API_KEY` checks/references that are no longer needed (the `gemini-client` handles auth internally)
- Fix the misleading error labels ("Kimi AI error" -> "Gemini API error")

### 2. `supabase/functions/demo-session/index.ts`

- Add `import { geminiChat } from "../_shared/gemini-client.ts";`
- Replace the Lovable gateway fetch (line ~668) with `geminiChat({ model, messages, temperature })`
- Remove `LOVABLE_API_KEY` reference

## Result
All AI calls will route through `GEMINI_API_KEY` (direct to Google) instead of `LOVABLE_API_KEY` (Lovable Gateway), eliminating the 402 credit errors completely.

