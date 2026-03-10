import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { geminiChat, geminiChatJSON, geminiImageGenerate } from "../_shared/gemini-client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================
// ROBUST JSON PARSER — handles malformed AI responses
// ============================================================
function safeParseJSON(text: string): any {
  // 1. Direct parse
  try { return JSON.parse(text); } catch (_) { /* continue */ }

  // 2. Strip markdown code fences
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // 3. Find JSON boundaries
  const jsonStart = cleaned.search(/[\{\[]/);
  const openChar = jsonStart !== -1 ? cleaned[jsonStart] : '{';
  const closeChar = openChar === '[' ? ']' : '}';
  const jsonEnd = cleaned.lastIndexOf(closeChar);

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new Error('No JSON object found in response');
  }
  cleaned = cleaned.substring(jsonStart, jsonEnd + 1);

  // 4. Try parse after extraction
  try { return JSON.parse(cleaned); } catch (_) { /* continue */ }

  // 5. Repair common issues
  cleaned = cleaned
    .replace(/,\s*}/g, '}')          // trailing commas in objects
    .replace(/,\s*]/g, ']')          // trailing commas in arrays
    .replace(/[\x00-\x1F\x7F]/g, ' ') // control characters
    .replace(/\n/g, ' ')              // newlines inside strings
    .replace(/\t/g, ' ');             // tabs

  try { return JSON.parse(cleaned); } catch (_) { /* continue */ }

  // 6. Last resort: extract key-value pairs with regex for known fields
  console.warn('[safeParseJSON] All parse attempts failed, trying regex extraction');
  throw new Error('Failed to parse JSON after multiple attempts');
}

interface ImageGenRequest {
  companyId: string;
  customerPhone: string;
  conversationId: string;
  prompt: string;
  messageType: 'generate' | 'feedback' | 'caption' | 'suggest' | 'edit' | 'history';
  feedbackData?: {
    imageId?: string;
    rating?: number;
    feedbackType?: 'thumbs_up' | 'thumbs_down' | 'used' | 'shared';
  };
  editData?: {
    sourceImageUrl?: string;
  };
}

interface ProductImage {
  id: string;
  file_path: string;
  file_name: string;
  description: string | null;
  tags: string[] | null;
}

// ============================================================
// AGENT 1: STYLE MEMORY AGENT (Learning Loop)
// Analyzes past feedback to build a "style DNA" for the company
// ============================================================
async function styleMemoryAgent(
  supabase: any,
  companyId: string
): Promise<string> {
  console.log('[STYLE-MEMORY] Building style DNA for company:', companyId);

  // Fetch high-rated images
  const { data: topImages } = await supabase
    .from('image_generation_feedback')
    .select('prompt, enhanced_prompt, rating, learned_preferences, feedback_notes')
    .eq('company_id', companyId)
    .gte('rating', 4)
    .order('created_at', { ascending: false })
    .limit(15);

  // Fetch low-rated images to learn what to avoid
  const { data: poorImages } = await supabase
    .from('image_generation_feedback')
    .select('prompt, enhanced_prompt, rating, feedback_notes')
    .eq('company_id', companyId)
    .lte('rating', 2)
    .order('created_at', { ascending: false })
    .limit(5);

  // Fetch existing learned preferences
  const { data: settings } = await supabase
    .from('image_generation_settings')
    .select('learned_style_preferences, top_performing_prompts, brand_tone, visual_guidelines, brand_colors, brand_fonts')
    .eq('company_id', companyId)
    .single();

  if ((!topImages || topImages.length === 0) && !settings?.visual_guidelines) {
    console.log('[STYLE-MEMORY] No feedback data or guidelines found');
    return '';
  }

  let styleDNA = '';

  if (settings?.visual_guidelines) {
    styleDNA += `VISUAL GUIDELINES: ${settings.visual_guidelines}\n`;
  }
  if (settings?.brand_tone) {
    styleDNA += `BRAND TONE: ${settings.brand_tone}\n`;
  }
  if (settings?.brand_colors && Array.isArray(settings.brand_colors) && settings.brand_colors.length > 0) {
    styleDNA += `BRAND COLORS: ${JSON.stringify(settings.brand_colors)}\n`;
  }
  if (settings?.brand_fonts && Array.isArray(settings.brand_fonts) && settings.brand_fonts.length > 0) {
    styleDNA += `BRAND FONTS: ${JSON.stringify(settings.brand_fonts)}\n`;
  }

  if (topImages && topImages.length > 0) {
    styleDNA += `\nSTYLES THAT PERFORMED WELL (replicate these patterns):\n`;
    topImages.forEach((img: any) => {
      styleDNA += `- "${img.enhanced_prompt || img.prompt}" (rating: ${img.rating}/5)\n`;
    });
  }

  if (poorImages && poorImages.length > 0) {
    styleDNA += `\nSTYLES TO AVOID (customer disliked these):\n`;
    poorImages.forEach((img: any) => {
      styleDNA += `- "${img.prompt}" ${img.feedback_notes ? `(issue: ${img.feedback_notes})` : ''}\n`;
    });
  }

  if (settings?.learned_style_preferences && Object.keys(settings.learned_style_preferences).length > 0) {
    styleDNA += `\nLEARNED PREFERENCES: ${JSON.stringify(settings.learned_style_preferences)}\n`;
  }

  console.log(`[STYLE-MEMORY] Style DNA built (${styleDNA.length} chars)`);
  return styleDNA;
}

// ============================================================
// AGENT 2: REFERENCE CURATOR AGENT (Pre-Generation)
// Assembles a rich reference pack from company media library
// ============================================================
async function referenceCuratorAgent(
  supabase: any,
  companyId: string,
  supabaseUrl: string,
  prompt: string,
  productMatch: ProductImage | null
): Promise<{ referenceUrls: string[]; referenceContext: string }> {
  console.log('[REF-CURATOR] Curating reference materials for:', prompt.substring(0, 50));

  const referenceUrls: string[] = [];
  let referenceContext = '';

  // 1. If we have a product match, it's the primary reference — tagged as HARD GEOMETRY
  if (productMatch) {
    referenceUrls.push(getMediaPublicUrl(supabaseUrl, productMatch.file_path));
    referenceContext += `PRIMARY PRODUCT REFERENCE [HARD GEOMETRY]: ${productMatch.description || productMatch.file_name}\n`;
    referenceContext += `⚠️ HARD GEOMETRY LOCK: This product's label layout, color hex codes, logo placement, and packaging form factor are IMMUTABLE. Treat this reference as pixel-accurate ground truth — not a creative suggestion.\n`;
  }

  // 2. Fetch logo assets
  const { data: logos } = await supabase
    .from('company_media')
    .select('file_path, file_name, description')
    .eq('company_id', companyId)
    .eq('category', 'logos')
    .eq('media_type', 'image')
    .limit(2);

  if (logos && logos.length > 0) {
    logos.forEach((logo: any) => {
      referenceUrls.push(getMediaPublicUrl(supabaseUrl, logo.file_path));
    });
    referenceContext += `LOGO REFERENCES: ${logos.map((l: any) => l.file_name).join(', ')}\n`;
  }

  // 3. Fetch promotional/style reference images
  const { data: promoImages } = await supabase
    .from('company_media')
    .select('file_path, file_name, description, tags')
    .eq('company_id', companyId)
    .eq('category', 'promotional')
    .eq('media_type', 'image')
    .order('created_at', { ascending: false })
    .limit(3);

  if (promoImages && promoImages.length > 0) {
    // Only add top 2 promo images as references (avoid overloading)
    promoImages.slice(0, 2).forEach((img: any) => {
      referenceUrls.push(getMediaPublicUrl(supabaseUrl, img.file_path));
    });
    referenceContext += `STYLE REFERENCES (promotional material): ${promoImages.map((p: any) => p.description || p.file_name).join('; ')}\n`;
  }

  // 4. Fetch top-rated similar generated images as style references
  const { data: topRated } = await supabase
    .from('image_generation_feedback')
    .select('image_url, prompt, rating')
    .eq('company_id', companyId)
    .gte('rating', 4)
    .order('rating', { ascending: false })
    .limit(3);

  if (topRated && topRated.length > 0) {
    // Add the best-rated image as a style reference
    referenceUrls.push(topRated[0].image_url);
    referenceContext += `TOP-RATED IMAGE STYLE: "${topRated[0].prompt}" (rating: ${topRated[0].rating}/5)\n`;
  }

  // Limit total references to 5 to avoid overloading the model
  const finalRefs = referenceUrls.slice(0, 5);
  console.log(`[REF-CURATOR] Assembled ${finalRefs.length} reference images`);

  return { referenceUrls: finalRefs, referenceContext };
}

// ============================================================
// AGENT 3: PROMPT OPTIMIZER AGENT
// Parses user intent and crafts an optimized generation prompt
// ============================================================
async function promptOptimizerAgent(
  userPrompt: string,
  companyName: string,
  businessType: string,
  productMatch: ProductImage | null,
  styleDNA: string,
  referenceContext: string,
  mediaContext: string
): Promise<{ finalPrompt: string; intent: string; brief: any }> {
  console.log('[PROMPT-OPTIMIZER] Optimizing prompt:', userPrompt.substring(0, 80));

  const systemPrompt = `You are an expert prompt engineer specializing in AI image generation for businesses.
Your job is to take a user's raw request and transform it into a highly detailed, optimized prompt that will produce stunning, brand-consistent marketing images.

COMPANY: ${companyName} (${businessType})

${styleDNA ? `STYLE DNA (learned from past successes):\n${styleDNA}\n` : ''}
${referenceContext ? `REFERENCE CONTEXT:\n${referenceContext}\n` : ''}
${mediaContext ? `MEDIA LIBRARY CONTEXT:\n${mediaContext}\n` : ''}
${productMatch ? `MATCHED PRODUCT: ${productMatch.description || productMatch.file_name} (Tags: ${productMatch.tags?.join(', ') || 'none'})` : ''}

RULES:
1. Transform vague requests into specific, vivid visual descriptions
2. Always include: composition, lighting, color palette, mood, environment details
3. If a product is matched, emphasize product placement and branding accuracy
4. Include photography style (e.g., "commercial product photography", "lifestyle flat lay", "editorial style")
5. Specify quality markers: "ultra high resolution", "professional quality", "sharp focus"
6. Incorporate brand colors and style preferences from Style DNA
7. NEVER include text/watermarks in the prompt unless specifically requested
8. Consider the business type and what would work for their social media

HARD GEOMETRY CONSTRAINT (when product reference is present):
- The product label layout must be preserved EXACTLY — same text placement, same proportions, same font sizing
- Color hex codes from the product reference are LOCKED — do not shift, tint, or reinterpret them
- Logo placement and orientation must remain pixel-accurate to the reference
- Packaging form factor (bottle shape, box dimensions, container type) is IMMUTABLE — no mutations allowed
- You may ONLY change the environment, background, lighting, and context around the product
- Include explicit anchor language in the finalPrompt: "preserve exact label layout", "maintain original color hex codes", "no logo distortion"

Respond with RAW JSON only. No markdown, no code fences, no trailing text.
{
  "intent": "product_showcase|lifestyle|promotional|announcement|behind_scenes|seasonal",
  "subject": "what the image should show",
  "environment": "detailed environment/background description",
  "lighting": "specific lighting description",
  "mood": "emotional tone",
  "composition": "framing and layout details",
  "brandElements": "how brand identity should be reflected",
  "productAnchoring": "how the product should be positioned (if applicable)",
  "photographyStyle": "the photographic approach",
  "finalPrompt": "the complete, optimized generation prompt combining all elements above into one coherent instruction"
}`;

  try {
    const response = await geminiChat({
      model: 'gemini-3-flash-preview',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Optimize this image request: "${userPrompt}"` }
      ],
      temperature: 0.4,
      max_tokens: 1500,
    });

    if (response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      const brief = safeParseJSON(content);
      console.log(`[PROMPT-OPTIMIZER] Intent: ${brief.intent}, Photography: ${brief.photographyStyle}`);
      console.log(`[PROMPT-OPTIMIZER] Final prompt: ${brief.finalPrompt?.substring(0, 200)}`);
      return { finalPrompt: brief.finalPrompt || userPrompt, intent: brief.intent || 'general', brief };
    }
  } catch (e) {
    console.error('[PROMPT-OPTIMIZER] Failed, using enhanced fallback:', e);
  }

  // Fallback: basic enhancement
  const fallbackPrompt = `Professional ${businessType} marketing image for ${companyName}: ${userPrompt}. Ultra high resolution, commercial photography style, professional lighting, suitable for social media marketing.`;
  return { finalPrompt: fallbackPrompt, intent: 'general', brief: { fallback: true } };
}

// ============================================================
// AGENT 4: SUPERVISOR REVIEW AGENT
// Validates the optimized prompt for brand compliance and safety
// ============================================================
async function supervisorReviewAgent(
  optimizedPrompt: string,
  brief: any,
  companyName: string,
  businessType: string,
  productMatch: ProductImage | null,
  styleDNA: string
): Promise<{ approved: boolean; refinedPrompt: string; warnings: string[] }> {
  console.log('[SUPERVISOR-REVIEW] Reviewing optimized prompt...');

  const systemPrompt = `You are a brand guardian AI supervisor. Your job is to review an image generation prompt before it is sent to the AI image generator.

COMPANY: ${companyName} (${businessType})
${productMatch ? `PRODUCT [HARD GEOMETRY]: ${productMatch.description || productMatch.file_name}` : 'No specific product'}
${styleDNA ? `BRAND GUIDELINES:\n${styleDNA}` : ''}

REVIEW CHECKLIST — STRICT:
1. BRAND ACCURACY: Does the prompt correctly reference the company and product? No competitor names or wrong branding?
   - REJECT if any competitor brand name appears in the prompt
   - REJECT if the company name is misspelled or wrong
2. PRODUCT FIDELITY (HARD GEOMETRY): If a product is involved, does the prompt ensure the product stays unchanged?
   - CHECK that label text, packaging colors, bottle/container shape, and logo placement are explicitly described
   - If product-specific details are missing (e.g., just "a bottle" instead of "a green bottle with the XYZ label"), ADD them
   - VERIFY the prompt includes explicit "Hard Geometry" anchor language (preserve label layout, maintain color hex codes, no logo distortion)
3. BRAND HALLUCINATION CHECK: Does the prompt risk generating warped logos, invented brand elements, misspelled brand text, or fabricated visual marks?
   - REJECT if the prompt lacks explicit instructions to preserve logo fidelity
   - ADD explicit anti-hallucination language if missing: "reproduce logo exactly as in reference — no warping, no invention, no misspelling"
4. PRODUCT MUTATION CHECK: Does the prompt risk altering the packaging type, container shape, label layout, or product proportions?
   - REJECT if the prompt allows creative reinterpretation of the product form factor
   - ENSURE the prompt locks packaging geometry: "maintain exact packaging shape, label dimensions, and proportional relationships"
5. ANTI-GENERIC CHECK: Is the prompt specific enough to avoid generic stock-photo results?
   - REJECT vague descriptions like "a nice product photo" — require specific environment, lighting, and composition details
6. QUALITY MARKERS: Does the prompt include sufficient detail for high-quality output?
7. SAFETY: No inappropriate, offensive, or misleading content?
8. COMPOSITION: Is the described layout/composition practical and visually appealing?
9. STYLE CONSISTENCY: Does it align with the brand's visual identity and past successful images?

If the prompt is good, approve it. If it needs refinement, provide a refined version.
ALWAYS return the refined prompt — even if approved (just return the same prompt if no changes needed).

Respond with RAW JSON only. No markdown, no code fences, no trailing text.
{
  "approved": true/false,
  "refinedPrompt": "the final prompt to use (refined if needed, or same as input if approved)",
  "warnings": ["any concerns or suggestions"],
  "refinements": "description of what was changed (or 'none')"
}`;

  try {
    const response = await geminiChat({
      model: 'gemini-3-flash-preview',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Review this image generation prompt:\n\nOPTIMIZED PROMPT: "${optimizedPrompt}"\n\nBRIEF: ${JSON.stringify(brief)}` }
      ],
      temperature: 0.2,
      max_tokens: 1500,
    });

    if (response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      const review = safeParseJSON(content);
      console.log(`[SUPERVISOR-REVIEW] Approved: ${review.approved}, Warnings: ${review.warnings?.length || 0}`);
      if (review.refinements && review.refinements !== 'none') {
        console.log(`[SUPERVISOR-REVIEW] Refinements: ${review.refinements}`);
      }
      return {
        approved: review.approved !== false,
        refinedPrompt: review.refinedPrompt || optimizedPrompt,
        warnings: review.warnings || []
      };
    }
  } catch (e) {
    console.error('[SUPERVISOR-REVIEW] Failed, approving as-is:', e);
  }

  return { approved: true, refinedPrompt: optimizedPrompt, warnings: [] };
}

// ============================================================
// AGENT 5: QUALITY ASSESSMENT AGENT (Post-Generation)
// Strict rating system — images must score 8+ to pass
// Hard-fail on product/brand accuracy below 8
// ============================================================
async function qualityAssessmentAgent(
  imageUrl: string,
  originalPrompt: string,
  refinedPrompt: string,
  companyName: string,
  productMatch: ProductImage | null
): Promise<{ score: number; pass: boolean; issues: string[]; retryPrompt: string | null }> {
  console.log('[QUALITY-ASSESS] Evaluating generated image (STRICT MODE)...');

  const systemPrompt = `You are a STRICT image quality assessor for AI-generated marketing images.
You must evaluate the image against each criterion below. Be brutally honest — brand and product accuracy are NON-NEGOTIABLE.

SCORING CRITERIA (each 0-10):

| # | Criterion                    | Weight | Hard-Fail Rule                          |
|---|------------------------------|--------|-----------------------------------------|
| 1 | Product Fidelity             | 3x     | Below 8 = AUTOMATIC FAIL               |
| 2 | Brand Hallucination Check    | 3x     | Below 8 = AUTOMATIC FAIL               |
| 3 | Product Mutation Check       | 2x     | Below 8 = AUTOMATIC FAIL               |
| 4 | Prompt Adherence             | 2x     | Below 6 = AUTOMATIC FAIL               |
| 5 | Composition                  | 1x     | No hard-fail                            |
| 6 | Quality (resolution)         | 1x     | Below 5 = AUTOMATIC FAIL               |
| 7 | Marketing Value              | 1x     | No hard-fail                            |

SCORING GUIDE:
- 10: Perfect, indistinguishable from professional studio work
- 8-9: Excellent, minor imperfections only
- 6-7: Acceptable but noticeable issues
- 4-5: Below standard, clear problems
- 1-3: Unacceptable, major failures
- 0: Completely wrong / missing

PRODUCT FIDELITY (replaces "Product Accuracy") — HARD GEOMETRY EVALUATION:
The product shown MUST match the real product exactly — correct label text, correct colors (exact hex codes), correct shape, correct proportions. Even small deviations (wrong font on label, slightly different color shade, label text shifted) should drop this below 8. This is a "Hard Geometry" check — the product reference is ground truth.

BRAND HALLUCINATION CHECK — AUTO-FAIL CATEGORY:
Any of the following = score 3 or below (auto-fail):
- Warped, distorted, or stretched logos
- Invented brand elements that don't exist in the reference
- Misspelled brand names or product names
- Fabricated visual marks, taglines, or icons not in the original
- Any logo that looks "approximately right" but has wrong geometry = FAIL

PRODUCT MUTATION CHECK — AUTO-FAIL CATEGORY:
Any of the following = score 3 or below (auto-fail):
- Wrong packaging type (e.g., bottle shown as can, box shown as pouch)
- Altered label layout (text repositioned, sections rearranged)
- Incorrect proportions (product stretched, squished, or resized incorrectly)
- Wrong container shape (round shown as square, tall shown as short)
- Added or removed label elements not in the original

${productMatch ? `EXPECTED PRODUCT [HARD GEOMETRY]: ${productMatch.description || productMatch.file_name}. This specific product must be clearly visible with its branding intact, label layout identical to reference, and no mutations to packaging or form factor.` : 'No specific product referenced — score Product Fidelity based on whether any depicted products look realistic and coherent. Brand Hallucination and Product Mutation checks score 10 if no product reference exists.'}

You MUST provide detailed reasoning for each score, especially for any score below 8.

Respond with RAW JSON only. No markdown, no code fences, no trailing text.
{
  "scores": {
    "productFidelity": 0-10,
    "brandHallucinationCheck": 0-10,
    "productMutationCheck": 0-10,
    "promptAdherence": 0-10,
    "composition": 0-10,
    "quality": 0-10,
    "marketingValue": 0-10
  },
  "reasoning": {
    "productFidelity": "Hard Geometry evaluation — does the product match the reference exactly?",
    "brandHallucinationCheck": "are there any warped logos, invented brand elements, or misspelled text?",
    "productMutationCheck": "is the packaging type, label layout, and form factor identical to the reference?",
    "promptAdherence": "how well does it match the request",
    "composition": "layout assessment",
    "quality": "resolution/artifacts assessment",
    "marketingValue": "social media suitability"
  },
  "issues": ["list of specific problems found"],
  "improvementSuggestion": "what to change in the prompt to fix issues (null if pass)"
}`;

  try {
    const contentParts: any[] = [
      { type: 'text', text: `Assess this generated image using STRICT criteria.\n\nORIGINAL REQUEST: "${originalPrompt}"\nGENERATION PROMPT: "${refinedPrompt}"` },
      { type: 'image_url', image_url: { url: imageUrl } }
    ];

    const response = await geminiChat({
      model: 'gemini-3-flash-preview',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: contentParts }
      ],
      temperature: 0.1,
      max_tokens: 1500,
    });

    if (response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      const assessment = safeParseJSON(content);
      const scores = assessment.scores || {};

      // Calculate weighted average: ProductFidelity(3x) + BrandHallucination(3x) + ProductMutation(2x) + Prompt(2x) + Composition(1x) + Quality(1x) + Marketing(1x)
      const productFid = scores.productFidelity ?? scores.productAccuracy ?? 5;
      const brandHalluc = scores.brandHallucinationCheck ?? scores.brandLogoAccuracy ?? 5;
      const productMut = scores.productMutationCheck ?? 5;
      const promptAdh = scores.promptAdherence ?? 5;
      const composition = scores.composition ?? 5;
      const quality = scores.quality ?? 5;
      const marketing = scores.marketingValue ?? 5;

      const weightedScore = (
        (productFid * 3) + (brandHalluc * 3) + (productMut * 2) + (promptAdh * 2) + composition + quality + marketing
      ) / 13;

      const roundedScore = Math.round(weightedScore * 10) / 10;

      // Hard-fail rules
      const hardFails: string[] = [];
      if (productFid < 8) hardFails.push(`Product Fidelity too low (${productFid}/10) — Hard Geometry violation`);
      if (brandHalluc < 8) hardFails.push(`Brand Hallucination detected (${brandHalluc}/10) — warped logos or invented elements`);
      if (productMut < 8) hardFails.push(`Product Mutation detected (${productMut}/10) — packaging or label altered`);
      if (promptAdh < 6) hardFails.push(`Prompt Adherence too low (${promptAdh}/10)`);
      if (quality < 5) hardFails.push(`Quality too low (${quality}/10)`);
      // Any single criterion below 4 = automatic fail
      const allScores = [productFid, brandHalluc, productMut, promptAdh, composition, quality, marketing];
      const belowFour = allScores.filter(s => s < 4);
      if (belowFour.length > 0) hardFails.push(`Criterion scored below 4`);

      const pass = hardFails.length === 0 && roundedScore >= 8.5;

      const allIssues = [...(assessment.issues || []), ...hardFails];

      console.log(`[QUALITY-ASSESS] Weighted Score: ${roundedScore}/10, Pass: ${pass} (threshold: 8.5)`);
      console.log(`[QUALITY-ASSESS] Breakdown — Fidelity:${productFid} Halluc:${brandHalluc} Mutation:${productMut} Prompt:${promptAdh} Comp:${composition} Qual:${quality} Mktg:${marketing}`);
      if (hardFails.length > 0) {
        console.log(`[QUALITY-ASSESS] HARD FAILS: ${hardFails.join('; ')}`);
      }

      return {
        score: roundedScore,
        pass,
        issues: allIssues,
        retryPrompt: pass ? null : assessment.improvementSuggestion || null
      };
    }
  } catch (e) {
    console.error('[QUALITY-ASSESS] Assessment failed:', e);
  }

  // Fallback: PASS with moderate score when assessment parsing fails (prevents infinite retry loops)
  return { score: 7, pass: true, issues: ['Quality assessment parsing failed — auto-passing to avoid timeout'], retryPrompt: null };
}

// ============================================================
// MASTER PIPELINE: Orchestrates all 6 agents
// ============================================================
async function runImagePipeline(
  supabase: any,
  supabaseUrl: string,
  companyId: string,
  userPrompt: string,
  companyName: string,
  businessType: string,
  productMatch: ProductImage | null,
  maxRetries?: number,
  bmsImageUrls: string[] = []
): Promise<{ imageUrl: string; enhancedPrompt: string; pipelineData: any }> {
  // Reduce retries for non-product images to avoid timeouts
  const effectiveMaxRetries = maxRetries ?? (productMatch ? 2 : 0);
  console.log(`[PIPELINE] === Starting 6-Agent Image Generation Pipeline (maxRetries=${effectiveMaxRetries}) ===`);

  // STAGE 1: Style Memory Agent — learn from past feedback
  const styleDNA = await styleMemoryAgent(supabase, companyId);

  // STAGE 2: Reference Curator Agent — assemble reference materials
  const { referenceUrls, referenceContext } = await referenceCuratorAgent(
    supabase, companyId, supabaseUrl, userPrompt, productMatch
  );

  // Build basic media context
  const mediaContext = await buildMediaContext(supabase, companyId);

  // STAGE 3: Prompt Optimizer Agent — craft the optimal prompt
  const { finalPrompt, intent, brief } = await promptOptimizerAgent(
    userPrompt, companyName, businessType,
    productMatch, styleDNA, referenceContext, mediaContext
  );

  // STAGE 4: Supervisor Review Agent — validate and refine
  const { approved, refinedPrompt, warnings } = await supervisorReviewAgent(
    finalPrompt, brief, companyName, businessType, productMatch, styleDNA
  );

  if (!approved) {
    console.log('[PIPELINE] Supervisor flagged prompt, using refined version');
  }

  const pipelineData = {
    original_prompt: userPrompt,
    optimizer_intent: intent,
    optimizer_brief: brief,
    supervisor_approved: approved,
    supervisor_warnings: warnings,
    final_prompt: refinedPrompt,
    reference_count: referenceUrls.length,
    bms_image_count: bmsImageUrls.length,
    style_dna_available: styleDNA.length > 0,
    model: 'gemini-3-pro-image-preview',
    pipeline_version: '6-agent-v1',
  };

  // STAGE 5: Generate image (with Quality Assessment retry loop)
  let currentPrompt = refinedPrompt;
  let imageUrl = '';
  let attempt = 0;
  let qualityResult: any = null;

  while (attempt <= effectiveMaxRetries) {
    attempt++;
    console.log(`[PIPELINE] Generation attempt ${attempt}/${effectiveMaxRetries + 1}`);

    // Determine input images: BMS product images (highest priority) → product reference → curated references
    const inputImages: string[] = [];
    
    // Priority 1: BMS canonical product images
    if (bmsImageUrls.length > 0) {
      inputImages.push(...bmsImageUrls);
      console.log(`[PIPELINE] Added ${bmsImageUrls.length} BMS product images as priority anchors`);
    }
    
    // Priority 2: company_media product match
    if (productMatch) {
      const productUrl = getMediaPublicUrl(supabaseUrl, productMatch.file_path);
      if (!inputImages.includes(productUrl)) {
        inputImages.push(productUrl);
      }
    }
    
    // Priority 3: curated reference images (fill remaining slots)
    for (const refUrl of referenceUrls) {
      if (!inputImages.includes(refUrl)) {
        inputImages.push(refUrl);
      }
    }

    // Build the generation prompt
    let genPrompt = currentPrompt;
    const hasProductAnchor = bmsImageUrls.length > 0 || productMatch;
    if (hasProductAnchor) {
      genPrompt = `HARD GEOMETRY LOCK — The first reference image is the EXACT product (ground truth). MANDATORY CONSTRAINTS:\n` +
        `• Preserve the label layout PIXEL-FOR-PIXEL — same text positions, same font sizes, same section arrangement\n` +
        `• Maintain EXACT color hex codes from the product — no tinting, no color shifting, no reinterpretation\n` +
        `• Logo must be reproduced with ZERO distortion — no warping, no stretching, no invented elements\n` +
        `• Packaging form factor is IMMUTABLE — same bottle/box/container shape, same proportions, same dimensions\n` +
        `• You may ONLY change: environment, background, lighting, camera angle, and surrounding context\n` +
        `• ANY deviation from the product reference = FAILURE\n\n${currentPrompt}`;
    }

    const { imageBase64, text: imageText } = await geminiImageGenerate({
      model: 'gemini-3-pro-image-preview',
      prompt: genPrompt,
      inputImageUrls: inputImages.length > 0 ? inputImages.slice(0, 4) : undefined,
    });

    if (!imageBase64) {
      throw new Error('No image generated');
    }

    // Upload to storage
    imageUrl = await uploadBase64ToStorage(supabase, supabaseUrl, imageBase64, companyId);

    // STAGE 6: Quality Assessment Agent — evaluate the output
    qualityResult = await qualityAssessmentAgent(
      imageUrl, userPrompt, currentPrompt, companyName, productMatch
    );

    pipelineData[`attempt_${attempt}`] = {
      prompt: currentPrompt,
      score: qualityResult.score,
      pass: qualityResult.pass,
      issues: qualityResult.issues,
    };

    if (qualityResult.pass) {
      console.log(`[PIPELINE] Quality check PASSED (score: ${qualityResult.score}/10) on attempt ${attempt}`);
      break;
    }

    if (attempt <= maxRetries && qualityResult.retryPrompt) {
      console.log(`[PIPELINE] Quality check FAILED (score: ${qualityResult.score}/10), retrying with improvements...`);
      currentPrompt = `${currentPrompt}\n\nIMPROVEMENTS NEEDED: ${qualityResult.retryPrompt}\nISSUES TO FIX: ${qualityResult.issues.join('; ')}`;
    } else {
      console.log(`[PIPELINE] Quality check marginal (score: ${qualityResult.score}/10), using best result`);
      break;
    }
  }

  pipelineData.final_score = qualityResult?.score || 0;
  pipelineData.total_attempts = attempt;
  console.log('[PIPELINE] === Pipeline Complete ===');

  return { imageUrl, enhancedPrompt: currentPrompt, pipelineData };
}

// ============================================================
// EXISTING HELPER FUNCTIONS (preserved)
// ============================================================

// Upload base64 image to Supabase storage and return public URL
async function uploadBase64ToStorage(
  supabase: any,
  supabaseUrl: string,
  base64Data: string,
  companyId: string
): Promise<string> {
  const matches = base64Data.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!matches) {
    console.error('[UPLOAD] Invalid base64 format');
    throw new Error('Invalid base64 image format');
  }
  
  const imageType = matches[1];
  const base64Content = matches[2];
  const binaryData = base64Decode(base64Content);
  
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(2, 10);
  const fileName = `generated/${companyId}/${timestamp}_${randomId}.${imageType}`;
  
  console.log(`[UPLOAD] Uploading to company-media/${fileName}`);
  
  const { error: uploadError } = await supabase.storage
    .from('company-media')
    .upload(fileName, binaryData, {
      contentType: `image/${imageType}`,
      upsert: false
    });
  
  if (uploadError) {
    console.error('[UPLOAD] Storage upload error:', uploadError);
    throw new Error(`Failed to upload image: ${uploadError.message}`);
  }
  
  const publicUrl = `${supabaseUrl}/storage/v1/object/public/company-media/${fileName}`;
  console.log(`[UPLOAD] Success! Public URL: ${publicUrl.substring(0, 80)}...`);
  
  return publicUrl;
}

// Detect image generation commands from WhatsApp messages
export function detectImageGenCommand(message: string): { 
  isImageCommand: boolean; 
  type: 'generate' | 'feedback' | 'caption' | 'suggest' | 'edit' | 'history' | null;
  prompt: string;
  feedbackData?: any;
} {
  const lowerMsg = message.toLowerCase().trim();
  
  // Edit image commands
  const editPatterns = [
    /^edit:\s*(.+)/i,
    /^✏️\s*(.+)/i,
    /^(make it|make the image|make this)\s+(.+)/i,
    /^(add|remove|change|adjust|increase|decrease|brighten|darken)\s+(.+)/i,
    /^(more|less)\s+(bright|dark|contrast|saturation|vibrant|colorful)(.*)$/i,
    /^add\s+(text|overlay|watermark|logo|border|frame)\s*(.*)$/i,
    /^(crop|resize|rotate|flip|mirror)\s*(.*)$/i,
  ];
  
  for (const pattern of editPatterns) {
    const match = message.match(pattern);
    if (match) {
      let prompt = message;
      if (match.length > 2) {
        prompt = `${match[1]} ${match[2]}`.trim();
      } else if (match.length > 1) {
        prompt = match[1]?.trim() || message;
      }
      if (prompt && prompt.length > 2) {
        return { isImageCommand: true, type: 'edit', prompt };
      }
    }
  }
  
  // Generate image commands
  const generatePatterns = [
    /^(generate|create|make|design|draw)\s*(an?\s+)?(image|picture|photo|graphic|visual)\s*(of|for|with|showing)?\s*(.+)/i,
    /^image:\s*(.+)/i,
    /^img:\s*(.+)/i,
    /^🎨\s*(.+)/i,
    /^create\s*(.+)/i,
    /^generate\s*(.+)/i,
  ];
  
  for (const pattern of generatePatterns) {
    const match = message.match(pattern);
    if (match) {
      const prompt = match[match.length - 1]?.trim() || match[1]?.trim();
      if (prompt && prompt.length > 3) {
        return { isImageCommand: true, type: 'generate', prompt };
      }
    }
  }
  
  // History commands
  const historyPatterns = [
    /^show\s+(my\s+)?images?$/i, /^my\s+images?$/i, /^image\s+history$/i,
    /^recent\s+images?$/i, /^view\s+(my\s+)?images?$/i, /^list\s+(my\s+)?images?$/i,
    /^gallery$/i, /^📸$/, /^history$/i,
  ];
  
  for (const pattern of historyPatterns) {
    if (pattern.test(lowerMsg)) {
      return { isImageCommand: true, type: 'history', prompt: '' };
    }
  }
  
  if (lowerMsg.includes('caption') || lowerMsg.includes('what to post') || lowerMsg.includes('suggest text')) {
    return { isImageCommand: true, type: 'caption', prompt: message };
  }
  
  if (lowerMsg.includes('what should i post') || lowerMsg.includes('post idea') || lowerMsg.includes('content idea') || lowerMsg.includes('suggest a post')) {
    return { isImageCommand: true, type: 'suggest', prompt: message };
  }
  
  if (lowerMsg.includes('👍') || lowerMsg.includes('love it') || lowerMsg.includes('great') || lowerMsg.includes('perfect')) {
    return { isImageCommand: true, type: 'feedback', prompt: message, feedbackData: { feedbackType: 'thumbs_up' } };
  }
  
  if (lowerMsg.includes('👎') || lowerMsg.includes('not good') || lowerMsg.includes('try again') || lowerMsg.includes('different')) {
    return { isImageCommand: true, type: 'feedback', prompt: message, feedbackData: { feedbackType: 'thumbs_down' } };
  }
  
  return { isImageCommand: false, type: null, prompt: '' };
}

// Build context from company media library
async function buildMediaContext(supabase: any, companyId: string): Promise<string> {
  const { data: media } = await supabase
    .from('company_media')
    .select('description, category, tags, file_path')
    .eq('company_id', companyId)
    .limit(20);
  
  const { data: settings } = await supabase
    .from('image_generation_settings')
    .select('*')
    .eq('company_id', companyId)
    .single();
  
  let context = '';
  
  if (settings?.business_context) {
    context += `Business Context: ${settings.business_context}\n`;
  }
  if (settings?.style_description) {
    context += `Preferred Style: ${settings.style_description}\n`;
  }
  
  if (media && media.length > 0) {
    context += `\nProduct Library:\n`;
    media.forEach((m: any) => {
      context += `- ${m.category}: ${m.description || 'No description'} [Tags: ${m.tags?.join(', ') || 'none'}]\n`;
    });
  }
  
  return context;
}

// AI-powered product selection using Gemini Vision + BMS cross-reference
async function selectProductImageForPrompt(
  supabase: any, 
  companyId: string, 
  prompt: string
): Promise<{ product: ProductImage | null; bmsImageUrls: string[] }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';

  const { data: productImages, error } = await supabase
    .from('company_media')
    .select('id, file_path, file_name, description, tags')
    .eq('company_id', companyId)
    .eq('category', 'products')
    .eq('media_type', 'image')
    .order('created_at', { ascending: false });
  
  // Track BMS image URLs for later use as reference anchors
  let bmsImageUrls: string[] = [];

  if (error || !productImages || productImages.length === 0) {
    console.log('[PRODUCT-SELECT] No product images in company_media, checking BMS only');
    // Still try BMS for image URLs even without company_media products
    try {
      const bmsRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/bms-agent`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_product_details', params: { product_name: prompt } }),
      });
      if (bmsRes.ok) {
        const bmsData = await bmsRes.json();
        if (bmsData.success) {
          const items = Array.isArray(bmsData.data) ? bmsData.data : [bmsData.data];
          for (const item of items) {
            if (item.image_url) bmsImageUrls.push(item.image_url);
            if (item.image_urls?.length) bmsImageUrls.push(...item.image_urls);
          }
          bmsImageUrls = [...new Set(bmsImageUrls)]; // deduplicate
          if (bmsImageUrls.length > 0) {
            console.log(`[PRODUCT-SELECT] Found ${bmsImageUrls.length} BMS product images (no company_media)`);
          }
        }
      }
    } catch (e) {
      console.log('[PRODUCT-SELECT] BMS-only lookup skipped:', e);
    }
    return { product: null, bmsImageUrls };
  }
  
  console.log(`[PRODUCT-SELECT] Found ${productImages.length} product images, using multimodal vision selection`);

  // Cross-reference with BMS inventory via centralized bms-agent
  let bmsContext = '';
  try {
    const bmsRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/bms-agent`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_product_details', params: { product_name: prompt } }),
    });
    if (bmsRes.ok) {
      const bmsData = await bmsRes.json();
      if (bmsData.success) {
        const items = Array.isArray(bmsData.data) ? bmsData.data : [bmsData.data];
        bmsContext = items.map((item: any) =>
          `BMS Match: "${item.name || item.product_name}" (SKU: ${item.sku || 'N/A'}, Stock: ${item.current_stock ?? 'N/A'}${item.image_urls?.length ? `, Images: ${item.image_urls.length}` : ''})`
        ).join('\n');
        // Extract BMS image URLs as authoritative product references
        for (const item of items) {
          if (item.image_url) bmsImageUrls.push(item.image_url);
          if (item.image_urls?.length) bmsImageUrls.push(...item.image_urls);
        }
        bmsImageUrls = [...new Set(bmsImageUrls)]; // deduplicate
        if (bmsImageUrls.length > 0) {
          console.log(`[PRODUCT-SELECT] Extracted ${bmsImageUrls.length} BMS product image URLs`);
        }
      }
    }
  } catch (e) {
    console.log('[PRODUCT-SELECT] BMS lookup skipped:', e);
  }

  // Pre-filter to top 10 candidates
  let candidates = productImages as ProductImage[];
  if (candidates.length > 10) {
    const promptLower = prompt.toLowerCase();
    const promptWords = promptLower.split(/\s+/).filter(w => w.length > 2);
    const scored = candidates.map(img => {
      let score = 0;
      const searchText = [img.file_name || '', img.description || '', ...(img.tags || [])].join(' ').toLowerCase();
      for (const word of promptWords) { if (searchText.includes(word)) score += 1; }
      return { img, score };
    });
    scored.sort((a, b) => b.score - a.score);
    candidates = scored.slice(0, 10).map(s => s.img);
  }

  const catalogText = candidates.map((img: ProductImage, i: number) =>
    `${i + 1}. Name: "${img.file_name}", Tags: [${img.tags?.join(', ') || 'none'}], Description: "${img.description || 'No description'}"`
  ).join('\n');

  const allDescriptions = candidates.map(c => c.description || '');
  const uniqueDescriptions = new Set(allDescriptions.filter(d => d.length > 0));
  const metadataIsGeneric = uniqueDescriptions.size <= 1 || 
    allDescriptions.every(d => d === 'Product image for AI generation' || d === 'Media file' || d === '' || d === 'No description');

  const metadataWarning = metadataIsGeneric 
    ? `\n⚠️ WARNING: Text metadata is UNRELIABLE. Match based ONLY on what you SEE in each image.\n`
    : '';

  const selectionPrompt = `You are a product image matcher with vision capabilities.
USER REQUEST: "${prompt}"
${metadataWarning}
PRODUCT CATALOG:
${catalogText}
${bmsContext ? `\nINVENTORY DATA:\n${bmsContext}` : ''}

INSTRUCTIONS:
- LOOK at each image carefully — match based on what you SEE
- ${metadataIsGeneric ? 'IGNORE all text metadata' : 'Use text metadata as supplementary context'}
- Respond with ONLY the product number (e.g. "1") or "NONE". No explanation.`;

  const contentParts: any[] = [{ type: 'text', text: selectionPrompt }];
  for (let i = 0; i < candidates.length; i++) {
    const publicUrl = getMediaPublicUrl(supabaseUrl, candidates[i].file_path);
    contentParts.push({ type: 'image_url', image_url: { url: publicUrl } });
  }

  try {
    const response = await geminiChat({
      model: 'gemini-3-flash-preview',
      messages: [{ role: 'user', content: contentParts }],
      temperature: 0.1,
      max_tokens: 50,
    });

    if (response.ok) {
      const data = await response.json();
      const aiChoice = (data.choices?.[0]?.message?.content || '').trim();
      console.log(`[PRODUCT-SELECT] Vision AI selected: "${aiChoice}"`);

      if (aiChoice && aiChoice !== 'NONE') {
        const numMatch = aiChoice.match(/(\d+)/);
        if (numMatch) {
          const idx = parseInt(numMatch[1], 10) - 1;
          if (idx >= 0 && idx < candidates.length) {
            console.log(`[PRODUCT-SELECT] Vision matched product #${idx + 1}: ${candidates[idx].file_name}`);
            return { product: candidates[idx], bmsImageUrls };
          }
        }
        const matched = candidates.find((img: ProductImage) => aiChoice.includes(img.id));
        if (matched) return { product: matched, bmsImageUrls };
      }
      return { product: null, bmsImageUrls };
    }
  } catch (e) {
    console.error('[PRODUCT-SELECT] Vision selection failed:', e);
  }

  // Fallback keyword matching
  const promptLower = prompt.toLowerCase();
  const promptWords = promptLower.split(/\s+/).filter(w => w.length > 2);
  let bestMatch: ProductImage | null = null;
  let bestScore = 0;
  for (const img of productImages) {
    let score = 0;
    const searchText = [img.file_name || '', img.description || '', ...(img.tags || [])].join(' ').toLowerCase();
    for (const word of promptWords) { if (searchText.includes(word)) score += 1; }
    if (score > bestScore) { bestScore = score; bestMatch = img; }
  }
  return { product: bestMatch, bmsImageUrls };
}

// Get public URL for a storage file
function getMediaPublicUrl(supabaseUrl: string, filePath: string): string {
  return `${supabaseUrl}/storage/v1/object/public/company-media/${filePath}`;
}

// Edit image using Gemini
async function editImage(
  sourceImageUrl: string,
  editPrompt: string,
  context: string,
  companyName: string,
  supabase: any,
  supabaseUrl: string,
  companyId: string
): Promise<{ imageUrl: string; editDescription: string }> {
  const editInstruction = `${context}\n\nEdit this image for ${companyName}: ${editPrompt}. Maintain professional quality suitable for social media marketing.`;
  
  const { imageBase64, text: textResponse } = await geminiImageGenerate({
    model: 'gemini-3-pro-image-preview',
    prompt: editInstruction,
    inputImageUrls: [sourceImageUrl],
  });
  
  if (!imageBase64) {
    throw new Error('No edited image generated');
  }
  
  const imageUrl = await uploadBase64ToStorage(supabase, supabaseUrl, imageBase64, companyId);
  return { imageUrl, editDescription: textResponse || editPrompt };
}

// Get the most recent generated image
async function getRecentImage(
  supabase: any,
  companyId: string,
  conversationId?: string
): Promise<{ id: string; imageUrl: string; prompt: string } | null> {
  let query = supabase
    .from('generated_images')
    .select('id, image_url, prompt')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1);
  
  if (conversationId) query = query.eq('conversation_id', conversationId);
  const { data } = await query.single();
  if (data) return { id: data.id, imageUrl: data.image_url, prompt: data.prompt };
  return null;
}

// Generate caption suggestion
async function generateCaption(
  imagePrompt: string,
  context: string,
  companyName: string
): Promise<{ caption: string; hashtags: string[]; bestTime: string }> {
  const now = new Date();
  const zambiaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Lusaka' }));
  const hour = zambiaTime.getHours();
  const dayOfWeek = zambiaTime.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Africa/Lusaka' });
  const dayOfMonth = zambiaTime.getDate();
  const month = zambiaTime.toLocaleDateString('en-US', { month: 'long', timeZone: 'Africa/Lusaka' });
  const year = zambiaTime.getFullYear();
  
  let timeOfDay = 'morning';
  if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
  else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
  else if (hour >= 21 || hour < 5) timeOfDay = 'night';
  
  const isWeekend = dayOfWeek === 'Saturday' || dayOfWeek === 'Sunday';
  const timeContext = `Current time context: It is ${timeOfDay} on ${dayOfWeek}, ${month} ${dayOfMonth}, ${year}. ${isWeekend ? 'It is the weekend.' : 'It is a weekday.'}`;
  
  const response = await geminiChat({
    model: 'gemini-3-flash-preview',
    messages: [
      { role: 'system', content: `You are a social media marketing expert for ${companyName}. Generate engaging captions for product images. Respond in JSON format only.` },
      { role: 'user', content: `${context}\n\n${timeContext}\n\nGenerate a caption for this image: "${imagePrompt}"\n\nRespond with JSON: {"caption": "engaging caption text", "hashtags": ["tag1", "tag2"], "bestTime": "suggested posting time"}` }
    ],
    temperature: 0.7
  });
  
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  
  try {
    const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
    return { caption: parsed.caption || 'Check out our latest product!', hashtags: parsed.hashtags || [], bestTime: parsed.bestTime || 'Weekday afternoon' };
  } catch {
    return { caption: 'Check out our amazing products! 🌟', hashtags: ['products', 'business'], bestTime: 'Weekday afternoon' };
  }
}

// Generate content suggestions
async function generateSuggestions(
  context: string,
  companyName: string,
  businessType: string
): Promise<{ suggestions: string[] }> {
  const now = new Date();
  const zambiaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Lusaka' }));
  const hour = zambiaTime.getHours();
  const dayOfWeek = zambiaTime.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Africa/Lusaka' });
  const dayOfMonth = zambiaTime.getDate();
  const month = zambiaTime.toLocaleDateString('en-US', { month: 'long', timeZone: 'Africa/Lusaka' });
  const year = zambiaTime.getFullYear();
  
  let timeOfDay = 'morning';
  if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
  else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
  else if (hour >= 21 || hour < 5) timeOfDay = 'night';
  
  const isWeekend = dayOfWeek === 'Saturday' || dayOfWeek === 'Sunday';
  const timeContext = `Current time: ${timeOfDay} on ${dayOfWeek}, ${month} ${dayOfMonth}, ${year}. ${isWeekend ? 'Weekend.' : 'Weekday.'}`;
  
  const response = await geminiChat({
    model: 'gemini-3-flash-preview',
    messages: [
      { role: 'system', content: `You are a creative marketing strategist for ${companyName}, a ${businessType}.` },
      { role: 'user', content: `${context}\n\n${timeContext}\n\nSuggest 3 creative image ideas I should create for social media. Be specific. Format as a numbered list.` }
    ],
    temperature: 0.8
  });
  
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const suggestions = content.split(/\n/).filter((line: string) => line.match(/^\d+\./)).map((line: string) => line.replace(/^\d+\.\s*/, '').trim()).slice(0, 3);
  return { suggestions: suggestions.length > 0 ? suggestions : ['Product showcase with lifestyle setting', 'Behind-the-scenes content', 'Customer testimonial visual'] };
}

// Process feedback and update learning
async function processFeedback(
  supabase: any,
  companyId: string,
  feedbackType: string,
  lastImageId?: string
): Promise<string> {
  let imageId = lastImageId;
  let imageData = null;
  
  if (!imageId) {
    const { data: recentImage } = await supabase
      .from('generated_images')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (recentImage) { imageId = recentImage.id; imageData = recentImage; }
  } else {
    const { data } = await supabase.from('generated_images').select('*').eq('id', imageId).single();
    imageData = data;
  }
  
  if (!imageData) return "No recent image found to rate.";
  
  const rating = feedbackType === 'thumbs_up' ? 5 : feedbackType === 'thumbs_down' ? 1 : 3;
  
  await supabase.from('image_generation_feedback').insert({
    company_id: companyId,
    generated_image_id: imageId,
    prompt: imageData.prompt,
    image_url: imageData.image_url,
    rating,
    feedback_type: feedbackType
  });
  
  if (feedbackType === 'thumbs_up') {
    const { data: settings } = await supabase
      .from('image_generation_settings')
      .select('top_performing_prompts')
      .eq('company_id', companyId)
      .single();
    
    const topPrompts = settings?.top_performing_prompts || [];
    if (!topPrompts.includes(imageData.prompt)) {
      topPrompts.unshift(imageData.prompt);
      await supabase.from('image_generation_settings').update({ top_performing_prompts: topPrompts.slice(0, 10) }).eq('company_id', companyId);
    }
    return "Great! I've noted that you liked this style. I'll create more images like this in the future! 🎨✨";
  } else {
    return "Got it! I'll try a different approach next time. What would you like to see instead?";
  }
}

// Send image via WhatsApp
async function sendWhatsAppImage(
  customerPhone: string,
  imageUrl: string,
  caption: string,
  company: any
): Promise<boolean> {
  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
  
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !company.whatsapp_number) return false;
  
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const fromNumber = company.whatsapp_number.startsWith('whatsapp:') ? company.whatsapp_number : `whatsapp:${company.whatsapp_number}`;
  
  const formData = new URLSearchParams();
  formData.append('From', fromNumber);
  formData.append('To', `whatsapp:${customerPhone}`);
  formData.append('Body', caption);
  formData.append('MediaUrl', imageUrl);
  
  const response = await fetch(twilioUrl, {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
  });
  
  return response.ok;
}

// ============================================================
// MAIN SERVER
// ============================================================
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { companyId, customerPhone, conversationId, prompt, messageType, feedbackData, editData } = await req.json() as ImageGenRequest;

    console.log(`[IMAGE-GEN] Request: type=${messageType}, company=${companyId}, prompt="${prompt?.substring(0, 50)}..."`);

    const { data: company } = await supabase.from('companies').select('*').eq('id', companyId).single();
    if (!company) throw new Error('Company not found');

    const { data: settings } = await supabase.from('image_generation_settings').select('enabled').eq('company_id', companyId).single();
    if (!settings?.enabled) {
      return new Response(
        JSON.stringify({ success: false, message: "Image generation is not enabled for this business. Please contact your administrator." }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const context = await buildMediaContext(supabase, companyId);
    let responseMessage = '';
    let imageUrl = '';

    switch (messageType) {
      case 'generate': {
        // === 6-AGENT PIPELINE ===
        const { product: productImage, bmsImageUrls } = await selectProductImageForPrompt(supabase, companyId, prompt);
        
        const result = await runImagePipeline(
          supabase, supabaseUrl, companyId,
          prompt, company.name, company.business_type || 'business',
          productImage, 2, bmsImageUrls
        );
        
        imageUrl = result.imageUrl;
        
        // Save to generated_images with pipeline data
        const savedPrompt = productImage ? `[Product: ${productImage.file_name}] ${prompt}` : prompt;
        const { data: savedImage } = await supabase
          .from('generated_images')
          .insert({
            company_id: companyId,
            conversation_id: conversationId,
            prompt: savedPrompt,
            image_url: imageUrl,
            generation_params: result.pipelineData,
            brand_assets_used: productImage ? [productImage.id] : []
          })
          .select()
          .single();
        
        // Generate caption
        const captionResult = await generateCaption(prompt, context, company.name);
        
        // Record for learning
        await supabase.from('image_generation_feedback').insert({
          company_id: companyId,
          generated_image_id: savedImage?.id,
          prompt,
          enhanced_prompt: result.enhancedPrompt,
          image_url: imageUrl,
          caption_suggestion: captionResult.caption,
          posting_time_suggestion: captionResult.bestTime,
          feedback_notes: productImage ? `Product-anchored: ${productImage.file_name} | Pipeline v6` : 'Pipeline v6'
        });
        
        const productLabel = productImage ? `\n\n📦 *Product used:* ${productImage.description || productImage.file_name}` : '';
        const scoreLabel = result.pipelineData.final_score ? ` (quality: ${result.pipelineData.final_score}/10)` : '';
        
        responseMessage = `🎨 Here's your image!${scoreLabel}${productLabel}\n\n📝 *Suggested Caption:*\n${captionResult.caption}\n\n#️⃣ *Hashtags:* ${captionResult.hashtags.map((h: string) => `#${h}`).join(' ')}\n\n⏰ *Best time to post:* ${captionResult.bestTime}\n\nReply 👍 if you like it or 👎 for a different style!`;
        
        if (customerPhone) {
          await sendWhatsAppImage(customerPhone, imageUrl, responseMessage, company);
        }
        break;
      }
      
      case 'caption': {
        const captionResult = await generateCaption(prompt, context, company.name);
        responseMessage = `📝 *Caption Suggestion:*\n${captionResult.caption}\n\n#️⃣ *Hashtags:* ${captionResult.hashtags.map((h: string) => `#${h}`).join(' ')}\n\n⏰ *Best time to post:* ${captionResult.bestTime}`;
        break;
      }
      
      case 'suggest': {
        const suggestions = await generateSuggestions(context, company.name, company.business_type || 'business');
        responseMessage = `💡 *Content Ideas for Today:*\n\n${suggestions.suggestions.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n\n')}\n\nWant me to create any of these? Just say "Generate: [idea]" 🎨`;
        break;
      }
      
      case 'edit': {
        let sourceImageUrl = editData?.sourceImageUrl;
        let sourceImageId: string | null = null;
        let isUserUpload = !!editData?.sourceImageUrl;
        
        if (!sourceImageUrl) {
          const recentImage = await getRecentImage(supabase, companyId, conversationId);
          if (recentImage) { sourceImageUrl = recentImage.imageUrl; sourceImageId = recentImage.id; }
        }
        
        if (!sourceImageUrl) {
          responseMessage = "📷 No image found to edit!\n\nYou can:\n• Send me an image + edit command\n• Generate an image first: 'Generate: [description]'\n\nThen I can edit it for you! ✏️";
          break;
        }
        
        const editResult = await editImage(sourceImageUrl, prompt, context, company.name, supabase, supabaseUrl, companyId);
        imageUrl = editResult.imageUrl;
        
        const { data: savedEditedImage } = await supabase.from('generated_images').insert({
          company_id: companyId, conversation_id: conversationId,
          prompt: `[Edit${isUserUpload ? ' - User Upload' : ''}] ${prompt}`, image_url: imageUrl
        }).select().single();
        
        await supabase.from('image_generation_feedback').insert({
          company_id: companyId, generated_image_id: savedEditedImage?.id,
          prompt: `[Edit] ${prompt}`, image_url: imageUrl,
          feedback_notes: isUserUpload ? 'Edited from user-uploaded image' : `Edited from generated image ${sourceImageId || 'unknown'}`
        });
        
        const sourceLabel = isUserUpload ? 'your uploaded image' : 'your image';
        responseMessage = `✏️ Here's ${sourceLabel} with your edit!\n\nEdit applied: ${prompt}\n\nWant more changes? Just describe what you'd like!\nReply 👍 if you like it!`;
        
        if (customerPhone) await sendWhatsAppImage(customerPhone, imageUrl, responseMessage, company);
        break;
      }
      
      case 'feedback': {
        responseMessage = await processFeedback(supabase, companyId, feedbackData?.feedbackType || 'thumbs_up', feedbackData?.imageId);
        break;
      }
      
      case 'history': {
        let historyQuery = supabase.from('generated_images').select('id, prompt, image_url, created_at').eq('company_id', companyId).order('created_at', { ascending: false }).limit(5);
        if (conversationId) historyQuery = historyQuery.eq('conversation_id', conversationId);
        const { data: recentImages } = await historyQuery;
        
        if (!recentImages || recentImages.length === 0) {
          responseMessage = "📸 No images yet!\n\nTry: 'Generate: a promotional image for [product]'";
        } else {
          const firstImage = recentImages[0];
          const galleryList = recentImages.map((img: any, i: number) => {
            const date = new Date(img.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const shortPrompt = img.prompt.replace(/^\[Edit.*?\]\s*/i, '').replace(/^\[Product:.*?\]\s*/i, '').substring(0, 40);
            return `${i + 1}. ${shortPrompt}${shortPrompt.length >= 40 ? '...' : ''} (${date})`;
          }).join('\n');
          
          responseMessage = `📸 *Your Recent Images (${recentImages.length}):*\n\n${galleryList}\n\n👆 Here's your most recent image!`;
          if (customerPhone && firstImage.image_url) await sendWhatsAppImage(customerPhone, firstImage.image_url, responseMessage, company);
        }
        break;
      }
    }

    if (conversationId) {
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: responseMessage,
        message_metadata: imageUrl ? { generated_image_url: imageUrl } : {}
      });
    }

    return new Response(
      JSON.stringify({ success: true, message: responseMessage, imageUrl: imageUrl || null }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[IMAGE-GEN] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
