

# Route Image Models Through Direct Gemini API

## Problem
Image generation models (`gemini-2.5-flash-image`, `gemini-3.1-flash-image`, etc.) are being routed through the Lovable AI Gateway using `LOVABLE_API_KEY`, which costs credits. You already have your own `GEMINI_API_KEY` that can call these models directly.

## Fix

### File: `supabase/functions/_shared/gemini-client.ts`

Remove the separate Lovable Gateway routing for image models. All models — text and image — will go through the direct Gemini OpenAI-compatible endpoint (`https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`) using your `GEMINI_API_KEY`.

Changes:
- Remove `lovableGatewayImageCall` function
- Remove `isImageModel` check that splits routing
- Send all requests (text + image) to `GEMINI_OPENAI_URL` with `GEMINI_API_KEY`
- Keep `modalities` parameter support for image generation requests
- Remove `LOVABLE_GATEWAY_URL` constant

This is a single-file change. All edge functions already pass the correct model name and `modalities` param — they just need the client to stop splitting the routing.

