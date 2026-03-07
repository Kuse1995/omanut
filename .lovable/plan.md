

# Plan: Migrate All AI from Lovable AI to Direct Gemini API

## Overview

21 edge functions currently call `https://ai.gateway.lovable.dev/v1/chat/completions` using `LOVABLE_API_KEY`. We'll switch them all to Google's OpenAI-compatible Gemini endpoint using your own API key.

## Step 1: Store your Gemini API key

Add a `GEMINI_API_KEY` secret with your key from Google AI Studio.

## Step 2: Create a shared helper

Create `supabase/functions/_shared/gemini-client.ts` with a reusable function that:
- Uses endpoint: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
- Authenticates with `GEMINI_API_KEY` via Bearer token
- Strips `google/` prefix from model names (e.g. `google/gemini-2.5-flash` → `gemini-2.5-flash`)
- Handles rate limits and errors consistently

```text
// Shared helper signature
geminiChat({ model, messages, temperature?, max_tokens?, tools?, tool_choice?, modalities? })
  → returns the JSON response (same shape as OpenAI format)
```

## Step 3: Update all 21 edge functions

Replace every `fetch('https://ai.gateway.lovable.dev/...')` call with a call to the shared helper. The affected functions:

| Function | Models Used |
|---|---|
| whatsapp-messages | configurable (default gemini-3-flash-preview) |
| boss-chat | configurable (default gemini-3-pro-preview) |
| meta-webhook | gemini-3-flash-preview |
| ai-playground | configurable |
| supervisor-agent | gemini-3-flash-preview |
| analyze-conversation | gemini-3-flash-preview |
| analyze-ai-quality | gemini-3-flash-preview |
| smart-configure | gemini-3-flash-preview |
| research-company | gemini-3-flash-preview |
| generate-reply-draft | configurable |
| ai-training-coach | gemini-2.5-flash |
| meta-lead-alert | gemini-2.5-flash-lite |
| analyze-media | gemini-2.5-flash |
| auto-content-creator | gemini-3-flash-preview + gemini-3-pro-image-preview |
| generate-business-image | gemini-2.5-flash-image-preview |
| test-image-generation | image models |
| whatsapp-image-gen | image models |
| analyze-reference-image | gemini-3-pro-image-preview |
| analyze-customer-image | vision model |
| demo-session | gemini-3-flash-preview |
| analyze-and-followup | gemini-3-pro-preview |

## Step 4: Image generation consideration

Google's OpenAI-compatible endpoint supports text models well. For **image generation** models (`gemini-*-image-preview` with `modalities: ['image', 'text']`), the shared helper will use the native Gemini REST API (`generateContent`) since the OpenAI-compatible endpoint may not support image output. The helper will abstract this difference.

## What stays the same
- All request/response shapes (OpenAI chat completions format)
- All model names in database (`company_ai_overrides`) — just stripped of `google/` prefix at call time
- All existing logic, prompts, tool calling

## What changes
- Gateway URL → Google's endpoint
- Auth header: `LOVABLE_API_KEY` → `GEMINI_API_KEY`
- One shared helper instead of duplicated fetch calls

