

# Fix: Video Prompt Quality — Faithful to Boss's Intent

## Problem

When the boss requests an "explainer video," the AI translates it into a generic visual description (e.g., "a kid on a tablet with a dove") instead of creating something that matches the requested video type. The Veo model then generates an ambient animation that doesn't match expectations.

## Root Cause

1. The `generate_video` tool description tells the AI to describe "what the video should show" with "camera movements, actions, and mood" — but gives no guidance to preserve the boss's **video type intent** (explainer, product showcase, testimonial, etc.)
2. The AI has no guidance to include **text/typography elements**, **step-by-step scenes**, or **structured content** in the prompt when an explainer format is requested
3. The system prompt doesn't tell the AI to be explicit about the visual format and content structure in the video prompt

## Solution

### 1. Improve `generate_video` tool description (`boss-chat/index.ts`, line 1010-1014)

Update the tool's `prompt` parameter description to instruct the AI to preserve the video type and include structured visual direction:

```
prompt: "Detailed description of what the video should show.
  IMPORTANT: If the boss requested a specific video TYPE (explainer, tutorial, product demo, testimonial),
  describe scenes that match that format:
  - Explainer: Show text titles, step-by-step visuals, infographics, screen recordings
  - Product demo: Show the product in use, close-ups, features highlighted
  - Testimonial: Show happy customers, quotes on screen, real usage
  Always include: camera movements, transitions, text overlays to include, and visual mood.
  Be SPECIFIC and LITERAL — describe exactly what should appear on screen frame by frame."
```

### 2. Enhance system prompt video section (`boss-chat/index.ts`, lines 309-316)

Add guidance for the AI to construct better video prompts:

```
- When constructing the video prompt, be VERY SPECIFIC and LITERAL about what should appear on screen.
- For EXPLAINER videos: describe text titles appearing, key points shown as visual text/icons,
  transitions between concepts. Example: "Text title 'How E Library Works' fades in, then shows
  a tablet screen displaying colorful ebook covers, camera zooms into a child's hands tapping
  to open a book, text overlay '1000+ Christian ebooks for kids' slides in from the right."
- ALWAYS include the company name and key message as text overlays in the prompt.
- Do NOT use vague/poetic descriptions. Be concrete about every visual element.
```

### 3. Inject business context into video prompt (`boss-chat/index.ts`, ~line 2159)

Before passing the prompt to `veoStartGeneration`, prepend company context so Veo generates relevant content:

```typescript
// Enrich video prompt with company context
const companyContext = company.business_type
  ? `This video is for "${company.name}", a ${company.business_type}. `
  : `This video is for "${company.name}". `;
const enrichedPrompt = companyContext + videoPrompt;
```

This ensures the model always knows what business the video is for, preventing generic/irrelevant visuals.

## Files Modified
- `supabase/functions/boss-chat/index.ts` — tool description, system prompt, and prompt enrichment

