

# Switch All AI Text/Tool-Calling to GLM 4.7 (Zhipu AI)

## Summary
Route all text and tool-calling AI through Zhipu AI's `glm-4.7` model. Image generation (Gemini/OpenAI) and video generation (Veo/MiniMax) remain unchanged.

## Prerequisites
You'll need to provide your **ZHIPU_API_KEY** from [open.bigmodel.cn](https://open.bigmodel.cn). I'll prompt you to add it as a secret.

## Changes

### 1. Add Zhipu routing to `gemini-client.ts`
Modify `geminiChat()` to detect `glm-` prefixed models and route to Zhipu's OpenAI-compatible endpoint (`https://open.bigmodel.cn/api/paas/v4/chat/completions`) using `ZHIPU_API_KEY`. Image/video/vision functions stay untouched.

### 2. Update database: set `primary_model` for all companies
```sql
UPDATE company_ai_overrides SET primary_model = 'glm-4.7';
```

### 3. Update hardcoded fallback defaults (3 files)
| File | Current fallback | New fallback |
|------|-----------------|--------------|
| `whatsapp-messages/index.ts` | `google/gemini-2.5-flash` | `glm-4.7` |
| `boss-chat/index.ts` | `google/gemini-3-pro-preview` | `glm-4.7` |
| `ai-playground/index.ts` | `google/gemini-2.5-flash` | `glm-4.7` |

### 4. Update hardcoded models in 13 additional edge functions
All `geminiChat()` calls with hardcoded Gemini models (non-vision, non-image tasks) switch to `glm-4.7`:

`analyze-conversation`, `analyze-and-followup`, `auto-content-creator`, `ai-training-coach`, `generate-reply-draft`, `meta-webhook`, `meta-lead-alert`, `research-company`, `smart-configure`, `supervisor-agent`, `extract-product-identity`, `test-image-generation` (text calls only), `whatsapp-image-gen` (text/caption calls only).

### What stays on Gemini
- `geminiImageGenerate()` — image generation
- `openaiImageGenerate/Edit()` — OpenAI image gen
- `veoStartGeneration/veoPollOperation()` — video generation
- `analyze-media` — vision analysis (multimodal image input)
- `reindex-company-media` — direct Gemini vision API
- `whatsapp-image-gen` image generation calls

## Technical Detail
Zhipu's API is OpenAI-compatible. Routing change in `gemini-client.ts`:

```text
if model starts with "glm-"
  → endpoint: https://open.bigmodel.cn/api/paas/v4/chat/completions
  → auth: ZHIPU_API_KEY
else
  → existing Gemini endpoint
  → auth: GEMINI_API_KEY
```

## Files to Edit

| File | Change |
|------|--------|
| `supabase/functions/_shared/gemini-client.ts` | Add Zhipu provider routing |
| `supabase/functions/whatsapp-messages/index.ts` | Default fallback → `glm-4.7` |
| `supabase/functions/boss-chat/index.ts` | Default fallback → `glm-4.7` |
| `supabase/functions/ai-playground/index.ts` | Default fallback → `glm-4.7` |
| 13 additional edge functions | Hardcoded model → `glm-4.7` |
| Database (data update) | `primary_model = 'glm-4.7'` for all companies |

