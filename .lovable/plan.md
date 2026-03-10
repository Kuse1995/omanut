

# Fix: Boss Chat Going Silent During Image Generation + Social Posting

## Root Cause Analysis

From the edge function logs, there are **two critical bugs** causing the AI to go silent:

### Bug 1: `whatsapp-image-gen` Quality Assessment JSON Parse Failures
The quality assessment agent (Agent 5) consistently fails to parse the AI's JSON response. Every single invocation in the logs shows:
```
SyntaxError: Expected ',' or '}' after property value in JSON at position 153
SyntaxError: Unterminated string in JSON at position 1020
SyntaxError: Expected double-quoted property name in JSON at position 154
```
When parsing fails, the catch block defaults to `score: 5, pass: false`, which triggers a retry. After 3 retries all fail (because the same parsing bug hits every time), the pipeline returns a marginal result. This wastes ~60-90 seconds of execution time.

### Bug 2: `boss-chat` 504 Gateway Timeout
The `whatsapp-image-gen` call takes so long (3 retries x ~20s each = ~60s+) that the `boss-chat` function exceeds the edge function timeout. The boss-chat gets a `504 Gateway Timeout`, the error is logged, and **no response is ever sent to the boss** — the AI goes completely silent.

### Bug 3: Prompt Optimizer also fails JSON parse
```
SyntaxError: Unterminated string in JSON at position 2128
```
Same pattern — AI returns slightly malformed JSON, rigid `JSON.parse()` breaks.

## Fix Plan

### 1. Robust JSON Parsing (all agents)
Add a `safeParseJSON(text)` helper that:
- Strips markdown code fences
- Attempts `JSON.parse`
- On failure: uses regex to extract key fields from the malformed JSON
- On total failure: returns a sensible default

Apply to: `promptOptimizerAgent`, `supervisorReviewAgent`, `qualityAssessmentAgent`

### 2. Reduce Quality Assessment Retries for Non-Product Images
When `productMatch` is null (no BMS product reference), reduce `maxRetries` from 3 to 1 — there's no "Hard Geometry" to validate, so one good generation is enough. This cuts execution time from ~90s to ~30s.

### 3. Add Timeout Guard in `boss-chat` for Image Generation
Wrap the `whatsapp-image-gen` fetch call in a `Promise.race` with a 45-second timeout. If it times out, return a graceful message instead of letting the entire function 504:
```
"Image is being generated in the background. I'll send it when ready!"
```

### 4. Add `response_format` hint to AI calls
Add explicit instruction "Respond with RAW JSON only. No markdown, no code fences, no trailing text." to reduce malformed responses.

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/whatsapp-image-gen/index.ts` | Add `safeParseJSON` helper, apply to Agents 3/4/5, reduce retries when no product match, add `response_format` hints |
| `supabase/functions/boss-chat/index.ts` | Add 45s timeout guard around `whatsapp-image-gen` calls, send graceful fallback on timeout |

## No database changes needed

