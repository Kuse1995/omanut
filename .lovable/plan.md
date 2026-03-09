

# Strict Image Quality Rating System

## Problem

The current Quality Assessment Agent (Agent 5 in `whatsapp-image-gen/index.ts`) has these weaknesses:
- Pass threshold is **7/10** — too lenient for brand/product accuracy failures
- Brand accuracy only gets "double weight" in the overall score but a 5/10 on brand accuracy can still pass
- On assessment failure, the fallback returns `score: 7, pass: true` — auto-passing without evaluation
- No hard-fail rules — an image with terrible logo accuracy but great composition can still pass

## Solution

### 1. Strict Rating Criteria with Hard-Fail Rules

Update the Quality Assessment Agent prompt and logic with:

**Scoring criteria (each 0-10):**
| Criterion | Weight | Hard-Fail Threshold |
|-----------|--------|-------------------|
| Product Accuracy | 3x | Below 8 = automatic fail |
| Brand/Logo Accuracy | 3x | Below 8 = automatic fail |
| Prompt Adherence | 2x | Below 6 = automatic fail |
| Composition | 1x | No hard-fail |
| Quality (resolution/artifacts) | 1x | Below 5 = automatic fail |
| Marketing Value | 1x | No hard-fail |

**Pass rules:**
- Weighted average must be **8.0 or above** (up from 7)
- Product Accuracy or Brand/Logo Accuracy below 8 = **automatic fail regardless of overall score**
- Any single criterion below 4 = automatic fail

### 2. Update `qualityAssessmentAgent` function

- Rewrite the system prompt with the strict criteria table
- Add hard-fail logic in code after parsing the scores
- Change fallback from `score: 7, pass: true` to `score: 5, pass: false` (force retry on assessment failure)
- Add detailed reasoning requirements so the agent explains exactly what's wrong

### 3. Update `supervisorReviewAgent` prompt

Add explicit instructions to check for:
- Competitor brand names in the prompt
- Missing product-specific details (label text, colors, packaging shape)
- Generic descriptions that could lead to off-brand results

### 4. Increase retry budget

Change `maxRetries` default from 2 to 3 — stricter criteria means more retries may be needed.

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/whatsapp-image-gen/index.ts` | Rewrite `qualityAssessmentAgent` prompt + scoring logic, update `supervisorReviewAgent`, increase retry budget |

## No database changes needed

The scoring criteria are enforced in the edge function logic, not stored in the database.

