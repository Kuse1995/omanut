import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { geminiChat, geminiChatJSON, geminiImageGenerate } from "../_shared/gemini-client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

  // 1. If we have a product match, it's the primary reference
  if (productMatch) {
    referenceUrls.push(getMediaPublicUrl(supabaseUrl, productMatch.file_path));
    referenceContext += `PRIMARY PRODUCT REFERENCE: ${productMatch.description || productMatch.file_name}\n`;
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

Respond ONLY with valid JSON:
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
      const cleaned = content.replace(/```json\n?|\n?```/g, '').trim();
      const brief = JSON.parse(cleaned);
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
${productMatch ? `PRODUCT: ${productMatch.description || productMatch.file_name}` : 'No specific product'}
${styleDNA ? `BRAND GUIDELINES:\n${styleDNA}` : ''}

REVIEW CHECKLIST:
1. BRAND ACCURACY: Does the prompt correctly reference the company and product? No competitor names or wrong branding?
2. PRODUCT FIDELITY: If a product is involved, does the prompt ensure the product stays unchanged?
3. QUALITY MARKERS: Does the prompt include sufficient detail for high-quality output?
4. SAFETY: No inappropriate, offensive, or misleading content?
5. COMPOSITION: Is the described layout/composition practical and visually appealing?
6. STYLE CONSISTENCY: Does it align with the brand's visual identity and past successful images?

If the prompt is good, approve it. If it needs refinement, provide a refined version.
ALWAYS return the refined prompt — even if approved (just return the same prompt if no changes needed).

Respond ONLY with valid JSON:
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
      const cleaned = content.replace(/```json\n?|\n?```/g, '').trim();
      const review = JSON.parse(cleaned);
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
// Evaluates generated image quality before delivery
// ============================================================
async function qualityAssessmentAgent(
  imageUrl: string,
  originalPrompt: string,
  refinedPrompt: string,
  companyName: string,
  productMatch: ProductImage | null
): Promise<{ score: number; pass: boolean; issues: string[]; retryPrompt: string | null }> {
  console.log('[QUALITY-ASSESS] Evaluating generated image...');

  const systemPrompt = `You are an image quality assessor for AI-generated marketing images.
Score the image on these criteria (each 0-10):

1. PROMPT ADHERENCE: Does the image match what was requested?
2. BRAND ACCURACY: Are product labels, logos, and branding correct?
3. COMPOSITION: Is the layout balanced and visually appealing?
4. QUALITY: Resolution, sharpness, no artifacts or distortions?
5. MARKETING VALUE: Would this work well on social media for ${companyName}?

${productMatch ? `EXPECTED PRODUCT: ${productMatch.description || productMatch.file_name}. Check that this specific product is clearly visible and its branding is intact.` : ''}

Respond ONLY with valid JSON:
{
  "scores": {
    "promptAdherence": 0-10,
    "brandAccuracy": 0-10,
    "composition": 0-10,
    "quality": 0-10,
    "marketingValue": 0-10
  },
  "overallScore": 0-10 (weighted average, brand accuracy weighs double),
  "pass": true if overallScore >= 7,
  "issues": ["list of specific problems found"],
  "improvementSuggestion": "what to change in the prompt to fix issues (null if pass)"
}`;

  try {
    const contentParts: any[] = [
      { type: 'text', text: `Assess this generated image.\n\nORIGINAL REQUEST: "${originalPrompt}"\nGENERATION PROMPT: "${refinedPrompt}"` },
      { type: 'image_url', image_url: { url: imageUrl } }
    ];

    const response = await geminiChat({
      model: 'gemini-3-flash-preview',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: contentParts }
      ],
      temperature: 0.1,
      max_tokens: 1000,
    });

    if (response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      const cleaned = content.replace(/```json\n?|\n?```/g, '').trim();
      const assessment = JSON.parse(cleaned);
      
      console.log(`[QUALITY-ASSESS] Score: ${assessment.overallScore}/10, Pass: ${assessment.pass}`);
      if (assessment.issues?.length > 0) {
        console.log(`[QUALITY-ASSESS] Issues: ${assessment.issues.join(', ')}`);
      }

      return {
        score: assessment.overallScore || 5,
        pass: assessment.pass !== false && (assessment.overallScore || 5) >= 7,
        issues: assessment.issues || [],
        retryPrompt: assessment.pass ? null : assessment.improvementSuggestion || null
      };
    }
  } catch (e) {
    console.error('[QUALITY-ASSESS] Assessment failed, passing by default:', e);
  }

  return { score: 7, pass: true, issues: [], retryPrompt: null };
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
  maxRetries: number = 2,
  bmsImageUrls: string[] = []
): Promise<{ imageUrl: string; enhancedPrompt: string; pipelineData: any }> {
  console.log('[PIPELINE] === Starting 6-Agent Image Generation Pipeline ===');

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
    style_dna_available: styleDNA.length > 0,
    model: 'gemini-3-pro-image-preview',
    pipeline_version: '6-agent-v1',
  };

  // STAGE 5: Generate image (with Quality Assessment retry loop)
  let currentPrompt = refinedPrompt;
  let imageUrl = '';
  let attempt = 0;
  let qualityResult: any = null;

  while (attempt <= maxRetries) {
    attempt++;
    console.log(`[PIPELINE] Generation attempt ${attempt}/${maxRetries + 1}`);

    // Determine input images: product reference + curated references
    const inputImages = productMatch 
      ? [getMediaPublicUrl(supabaseUrl, productMatch.file_path), ...referenceUrls.filter(u => u !== getMediaPublicUrl(supabaseUrl, productMatch.file_path))]
      : referenceUrls;

    // Build the generation prompt
    let genPrompt = currentPrompt;
    if (productMatch) {
      genPrompt = `CRITICAL: The first reference image is the EXACT product. Keep this product UNCHANGED — same label, logo, colors, shape, proportions. ONLY change the environment/background/lighting.\n\n${currentPrompt}`;
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
