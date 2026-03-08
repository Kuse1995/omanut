

# Additional Agents to Strengthen the Image Generation Pipeline

Beyond the already-planned **Prompt Optimizer** and **Supervisor Review** agents, here are agents that would meaningfully improve image quality and business value:

## 1. Quality Assessment Agent (Post-Generation)
**Purpose**: Evaluate the generated image *before* sending it to the customer.
- Runs after `geminiImageGenerate` returns
- Uses `gemini-3-flash-preview` vision to score the output on: prompt adherence (did it match the request?), brand accuracy (is the product/logo correct?), composition quality, text legibility
- Returns `{ score: 0-10, pass: boolean, issues: string[] }`
- If score < 7, auto-retries generation with a refined prompt (up to 2 retries) incorporating the issues found
- Prevents bad images from reaching customers entirely

## 2. Reference Curator Agent (Pre-Generation)
**Purpose**: Intelligently select and prepare reference materials beyond just product matching.
- Current `selectProductImageForPrompt` only finds one product image
- This agent would also pull: brand color palette, logo assets, previous high-rated images with similar prompts, competitor-avoid examples
- Assembles a "reference pack" — multiple input images for the generator (product + logo + style reference)
- Uses the existing `company_media` categories (Products, Promotional, Logos) to build a richer context

## 3. Style Memory Agent (Learning Loop)
**Purpose**: Learn from feedback to improve future generations.
- Analyzes the `image_generation_feedback` table (already exists with ratings)
- Before any generation, queries top-rated images for this company and extracts what made them successful
- Builds a "style DNA" summary: preferred lighting, color temperature, composition patterns, environments that performed well
- Feeds this into the Prompt Optimizer as a "learned preferences" block
- Periodically updates a `style_profile` field on `image_generation_settings`

## 4. A/B Variant Agent (Multi-Output)
**Purpose**: Generate 2-3 variations instead of one, letting the user pick.
- After the supervisor approves the prompt, creates 2-3 prompt variations: same product/subject but different angles (e.g., lifestyle vs. studio, warm vs. cool tones)
- Sends all variants to the customer as a gallery via WhatsApp
- Tracks which variant gets selected → feeds back into Style Memory Agent
- Only activates when the user's prompt is open-ended (not specific edits)

## Recommendation

For maximum immediate impact, I'd prioritize in this order:

| Priority | Agent | Why |
|----------|-------|-----|
| 1 | **Quality Assessment** | Catches bad outputs before they reach the customer — biggest quality win |
| 2 | **Reference Curator** | More reference context = better brand fidelity, uses existing media library |
| 3 | **Style Memory** | Feedback loop already has data, just needs to be consumed |
| 4 | **A/B Variant** | Nice-to-have, increases engagement but adds latency and cost |

Want me to add any or all of these to the pipeline plan alongside the Prompt Optimizer and Supervisor?

