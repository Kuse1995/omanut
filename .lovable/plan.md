

# Revised Cost Optimization: Tiered Approach (Quality-Safe)

## Problem with the Blanket Approach

Switching everything to `flash-lite` with 350 token cap risks breaking:
- Multi-tool reasoning (reservation flows, payment links)
- Parameter extraction accuracy
- Bilingual response quality

## Recommended Tiered Strategy

### Model Selection: Keep complexity routing, use cheaper models

| Complexity | Current Model | Proposed Model | Savings |
|------------|--------------|----------------|---------|
| `simple` (greetings, FAQs) | `gemini-3-flash-preview` | `google/gemini-2.5-flash-lite` | ~10x cheaper |
| `complex` (tools, reservations) | `gemini-3-pro-preview` | `google/gemini-2.5-flash` | ~5x cheaper |

This preserves tool-calling accuracy for complex flows while slashing costs on simple messages (which are ~60-70% of traffic).

### Context Window: 8 messages for simple, 12 for complex

- Simple queries: 8 messages is fine
- Complex/tool flows: Keep 12 to avoid losing reservation details mid-flow

### Output Tokens: 350 for simple, 1024 for complex

- Simple: 350 tokens (greetings, short answers)
- Complex: 1024 tokens (tool calls need room for JSON + response text)

### Input Validation: Same as planned

The `sanitizeMessages` guard applies regardless — this is a pure bug fix.

## Estimated Savings

- Simple messages (~65% of traffic): ~10x cheaper per call
- Complex messages (~35% of traffic): ~5x cheaper per call
- Context pruning: ~10x fewer input tokens across the board
- Error elimination: stops wasted billed retries

**Estimated drop: $74/day → $8-12/day** (vs $5 with flash-lite everywhere, but without breaking reservations)

## Changes in `supabase/functions/whatsapp-messages/index.ts`

| Change | Location | Before | After |
|--------|----------|--------|-------|
| Simple model | L1870 | `gemini-3-flash-preview` | `gemini-2.5-flash-lite` |
| Complex model | L1869 | `gemini-3-pro-preview` | `gemini-2.5-flash` |
| Simple max tokens | L1875 | `Math.min(2048, ...)` | `Math.min(350, ...)` |
| Complex max tokens | L1874 | `8192` | `1024` |
| History slice | L1775 | `.slice(-20)` | Conditional: 8 for simple, 12 for complex |
| History DB fetch | L967 | no limit | `.limit(12)` |
| Input validation | 3 call sites | none | `sanitizeMessages()` filter |

No database changes. Single file edit.

