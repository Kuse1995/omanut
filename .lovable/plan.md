

# Enforce "Hard Geometry" Product Fidelity in Image Generation Pipeline

## What Changes

Three areas in `supabase/functions/whatsapp-image-gen/index.ts` need hardening:

### 1. Reference Curator Agent — Mark BMS data as "Hard Geometry"
When BMS product images are present, tag the `referenceContext` with explicit "HARD GEOMETRY" constraints including the product's exact label layout, color hex codes (from `brand_colors` settings), and packaging type. This ensures downstream agents treat BMS references as immutable geometry, not creative suggestions.

### 2. Prompt Optimizer + Supervisor — Enforce geometry lock
- **Prompt Optimizer** (Agent 3): Add a `HARD GEOMETRY CONSTRAINT` rule block that instructs the prompt to preserve 100% of label layout, color hex codes, logo placement, and packaging form factor when BMS reference images are provided.
- **Supervisor Review** (Agent 4): Add explicit rejection criteria for "Brand Hallucination" (warped/invented logos) and "Product Mutation" (wrong packaging shape, altered labels). The supervisor must check for these failure modes by name.

### 3. Quality Assessment Agent — Raise threshold + add failure categories
- Rename/add explicit evaluation dimensions: **Product Fidelity** (replaces generic "Product Accuracy"), **Brand Hallucination Check**, **Product Mutation Check**
- Raise the pass threshold from `8.0` to `8.5`
- Add two new hard-fail categories in the scoring rubric:
  - `Brand Hallucination`: warped logos, invented brand elements, misspelled text → auto-fail
  - `Product Mutation`: wrong packaging type, altered label layout, incorrect proportions → auto-fail
- The `productAccuracy` hard-fail threshold stays at `< 8` but the overall weighted score must now exceed `8.5`

### 4. Generation prompt prefix — Strengthen anchor language
Update the `genPrompt` prefix (line ~579) from the current "CRITICAL: keep product UNCHANGED" to include explicit "Hard Geometry" terminology: preserve label layout pixel-for-pixel, maintain exact color hex codes, no logo distortion, no packaging mutation.

## File Changed

| File | Change |
|------|--------|
| `supabase/functions/whatsapp-image-gen/index.ts` | Update Agents 2-5: Hard Geometry tagging, Brand Hallucination / Product Mutation fail criteria, raise pass threshold to 8.5 |

