import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { geminiChat, geminiImageGenerate } from "../_shared/gemini-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ProductImage {
  id: string;
  file_path: string;
  file_name: string;
  description: string | null;
  tags: string[] | null;
}

function getMediaPublicUrl(supabaseUrl: string, filePath: string): string {
  return `${supabaseUrl}/storage/v1/object/public/company-media/${filePath}`;
}

// Upload base64 image to Supabase storage and return public URL
async function uploadBase64ToStorage(
  supabase: any,
  supabaseUrl: string,
  base64Data: string,
  companyId: string
): Promise<string> {
  const matches = base64Data.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!matches) throw new Error('Invalid base64 image format');
  
  const imageType = matches[1];
  const base64Content = matches[2];
  const binaryData = base64Decode(base64Content);
  
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(2, 10);
  const fileName = `generated/${companyId}/${timestamp}_${randomId}.${imageType}`;
  
  const { error: uploadError } = await supabase.storage
    .from('company-media')
    .upload(fileName, binaryData, { contentType: `image/${imageType}`, upsert: false });
  
  if (uploadError) throw new Error(`Failed to upload image: ${uploadError.message}`);
  
  return `${supabaseUrl}/storage/v1/object/public/company-media/${fileName}`;
}

// ============================================================
// AGENT 1: STYLE MEMORY AGENT
// ============================================================
async function styleMemoryAgent(supabase: any, companyId: string): Promise<string> {
  console.log('[STYLE-MEMORY] Building style DNA...');

  const [topRes, poorRes, settingsRes] = await Promise.all([
    supabase.from('image_generation_feedback').select('prompt, enhanced_prompt, rating, feedback_notes')
      .eq('company_id', companyId).gte('rating', 4).order('created_at', { ascending: false }).limit(15),
    supabase.from('image_generation_feedback').select('prompt, feedback_notes')
      .eq('company_id', companyId).lte('rating', 2).order('created_at', { ascending: false }).limit(5),
    supabase.from('image_generation_settings')
      .select('learned_style_preferences, brand_tone, visual_guidelines, brand_colors, brand_fonts')
      .eq('company_id', companyId).single()
  ]);

  const topImages = topRes.data;
  const poorImages = poorRes.data;
  const settings = settingsRes.data;

  if ((!topImages || topImages.length === 0) && !settings?.visual_guidelines) return '';

  let styleDNA = '';
  if (settings?.visual_guidelines) styleDNA += `VISUAL GUIDELINES: ${settings.visual_guidelines}\n`;
  if (settings?.brand_tone) styleDNA += `BRAND TONE: ${settings.brand_tone}\n`;
  if (settings?.brand_colors?.length > 0) styleDNA += `BRAND COLORS: ${JSON.stringify(settings.brand_colors)}\n`;
  if (settings?.brand_fonts?.length > 0) styleDNA += `BRAND FONTS: ${JSON.stringify(settings.brand_fonts)}\n`;

  if (topImages?.length > 0) {
    styleDNA += `\nSTYLES THAT PERFORMED WELL:\n`;
    topImages.forEach((img: any) => { styleDNA += `- "${img.enhanced_prompt || img.prompt}" (${img.rating}/5)\n`; });
  }
  if (poorImages?.length > 0) {
    styleDNA += `\nSTYLES TO AVOID:\n`;
    poorImages.forEach((img: any) => { styleDNA += `- "${img.prompt}" ${img.feedback_notes ? `(${img.feedback_notes})` : ''}\n`; });
  }
  if (settings?.learned_style_preferences && Object.keys(settings.learned_style_preferences).length > 0) {
    styleDNA += `\nLEARNED PREFERENCES: ${JSON.stringify(settings.learned_style_preferences)}\n`;
  }

  return styleDNA;
}

// ============================================================
// AGENT 2: REFERENCE CURATOR AGENT
// ============================================================
async function referenceCuratorAgent(
  supabase: any, companyId: string, supabaseUrl: string,
  productMatch: ProductImage | null
): Promise<{ referenceUrls: string[]; referenceContext: string }> {
  console.log('[REF-CURATOR] Curating references...');
  const referenceUrls: string[] = [];
  let referenceContext = '';

  if (productMatch) {
    referenceUrls.push(getMediaPublicUrl(supabaseUrl, productMatch.file_path));
    referenceContext += `PRIMARY PRODUCT: ${productMatch.description || productMatch.file_name}\n`;
  }

  const [logosRes, promoRes, topRatedRes] = await Promise.all([
    supabase.from('company_media').select('file_path, file_name').eq('company_id', companyId).eq('category', 'logos').eq('media_type', 'image').limit(2),
    supabase.from('company_media').select('file_path, file_name, description').eq('company_id', companyId).eq('category', 'promotional').eq('media_type', 'image').order('created_at', { ascending: false }).limit(2),
    supabase.from('image_generation_feedback').select('image_url, prompt, rating').eq('company_id', companyId).gte('rating', 4).order('rating', { ascending: false }).limit(1)
  ]);

  if (logosRes.data?.length > 0) {
    logosRes.data.forEach((l: any) => referenceUrls.push(getMediaPublicUrl(supabaseUrl, l.file_path)));
    referenceContext += `LOGOS: ${logosRes.data.map((l: any) => l.file_name).join(', ')}\n`;
  }
  if (promoRes.data?.length > 0) {
    promoRes.data.forEach((p: any) => referenceUrls.push(getMediaPublicUrl(supabaseUrl, p.file_path)));
    referenceContext += `STYLE REFS: ${promoRes.data.map((p: any) => p.description || p.file_name).join('; ')}\n`;
  }
  if (topRatedRes.data?.length > 0) {
    referenceUrls.push(topRatedRes.data[0].image_url);
    referenceContext += `TOP-RATED STYLE: "${topRatedRes.data[0].prompt}"\n`;
  }

  return { referenceUrls: referenceUrls.slice(0, 5), referenceContext };
}

// ============================================================
// AGENT 3: PROMPT OPTIMIZER AGENT
// ============================================================
async function promptOptimizerAgent(
  userPrompt: string, companyName: string, businessType: string,
  productMatch: ProductImage | null, styleDNA: string,
  referenceContext: string, contextInfo: string
): Promise<{ finalPrompt: string; intent: string; brief: any }> {
  console.log('[PROMPT-OPTIMIZER] Optimizing...');

  const systemPrompt = `You are an expert prompt engineer for AI image generation.
COMPANY: ${companyName} (${businessType})
${styleDNA ? `STYLE DNA:\n${styleDNA}\n` : ''}
${referenceContext ? `REFERENCES:\n${referenceContext}\n` : ''}
${contextInfo ? `CONTEXT:\n${contextInfo}\n` : ''}
${productMatch ? `PRODUCT: ${productMatch.description || productMatch.file_name} (Tags: ${productMatch.tags?.join(', ') || 'none'})` : ''}

Transform the user request into a detailed, optimized generation prompt.
Include: composition, lighting, color palette, mood, photography style, quality markers.
Respond ONLY with JSON: {"intent":"...", "photographyStyle":"...", "finalPrompt":"the complete optimized prompt"}`;

  try {
    const response = await geminiChat({
      model: 'glm-4.7',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Optimize: "${userPrompt}"` }
      ],
      temperature: 0.4, max_tokens: 1500,
    });
    if (response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      const brief = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
      console.log(`[PROMPT-OPTIMIZER] Intent: ${brief.intent}`);
      return { finalPrompt: brief.finalPrompt || userPrompt, intent: brief.intent || 'general', brief };
    }
  } catch (e) {
    console.error('[PROMPT-OPTIMIZER] Failed:', e);
  }

  return {
    finalPrompt: `Professional ${businessType} marketing image for ${companyName}: ${userPrompt}. Ultra high resolution, commercial photography, professional lighting.`,
    intent: 'general', brief: { fallback: true }
  };
}

// ============================================================
// AGENT 4: SUPERVISOR REVIEW AGENT
// ============================================================
async function supervisorReviewAgent(
  optimizedPrompt: string, brief: any, companyName: string,
  productMatch: ProductImage | null, styleDNA: string
): Promise<{ approved: boolean; refinedPrompt: string; warnings: string[] }> {
  console.log('[SUPERVISOR] Reviewing...');

  try {
    const response = await geminiChat({
      model: 'glm-4.7',
      messages: [
        { role: 'system', content: `You are a brand guardian reviewing an image prompt for ${companyName}.
${productMatch ? `Product: ${productMatch.description || productMatch.file_name}` : ''}
${styleDNA ? `Brand guidelines:\n${styleDNA}` : ''}
Check: brand accuracy, product fidelity, quality markers, safety, style consistency.
Respond ONLY JSON: {"approved":true/false,"refinedPrompt":"...","warnings":[],"refinements":"none or description"}` },
        { role: 'user', content: `Review: "${optimizedPrompt}"\nBrief: ${JSON.stringify(brief)}` }
      ],
      temperature: 0.2, max_tokens: 1500,
    });
    if (response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      const review = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
      console.log(`[SUPERVISOR] Approved: ${review.approved}`);
      return { approved: review.approved !== false, refinedPrompt: review.refinedPrompt || optimizedPrompt, warnings: review.warnings || [] };
    }
  } catch (e) {
    console.error('[SUPERVISOR] Failed:', e);
  }
  return { approved: true, refinedPrompt: optimizedPrompt, warnings: [] };
}

// ============================================================
// AGENT 5: QUALITY ASSESSMENT AGENT
// ============================================================
async function qualityAssessmentAgent(
  imageUrl: string, originalPrompt: string, refinedPrompt: string,
  companyName: string, productMatch: ProductImage | null
): Promise<{ score: number; pass: boolean; issues: string[]; retryPrompt: string | null }> {
  console.log('[QUALITY] Assessing...');

  try {
    const response = await geminiChat({
      model: 'glm-4.7',
      messages: [
        { role: 'system', content: `Score this AI-generated marketing image for ${companyName} on: prompt adherence, brand accuracy, composition, quality, marketing value (each 0-10).
${productMatch ? `Expected product: ${productMatch.description || productMatch.file_name}` : ''}
Respond JSON: {"overallScore":0-10,"pass":true/false (>=7),"issues":[],"improvementSuggestion":"..."}` },
        { role: 'user', content: [
          { type: 'text', text: `Original: "${originalPrompt}"\nPrompt: "${refinedPrompt}"` },
          { type: 'image_url', image_url: { url: imageUrl } }
        ] }
      ],
      temperature: 0.1, max_tokens: 1000,
    });
    if (response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      const a = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
      console.log(`[QUALITY] Score: ${a.overallScore}/10, Pass: ${a.pass}`);
      return { score: a.overallScore || 5, pass: a.pass !== false && (a.overallScore || 5) >= 7, issues: a.issues || [], retryPrompt: a.pass ? null : a.improvementSuggestion || null };
    }
  } catch (e) {
    console.error('[QUALITY] Failed:', e);
  }
  return { score: 7, pass: true, issues: [], retryPrompt: null };
}

// ============================================================
// MASTER PIPELINE
// ============================================================
async function runImagePipeline(
  supabase: any, supabaseUrl: string, companyId: string,
  userPrompt: string, companyName: string, businessType: string,
  productMatch: ProductImage | null, contextInfo: string,
  maxRetries: number = 2
): Promise<{ imageUrl: string; enhancedPrompt: string; pipelineData: any }> {
  console.log('[PIPELINE] === 6-Agent Pipeline Start ===');

  // Stages 1-2 in parallel
  const [styleDNA, { referenceUrls, referenceContext }] = await Promise.all([
    styleMemoryAgent(supabase, companyId),
    referenceCuratorAgent(supabase, companyId, supabaseUrl, productMatch)
  ]);

  // Stage 3: Optimize
  const { finalPrompt, intent, brief } = await promptOptimizerAgent(
    userPrompt, companyName, businessType, productMatch, styleDNA, referenceContext, contextInfo
  );

  // Stage 4: Supervisor
  const { approved, refinedPrompt, warnings } = await supervisorReviewAgent(
    finalPrompt, brief, companyName, productMatch, styleDNA
  );

  const pipelineData: any = {
    original_prompt: userPrompt,
    optimizer_intent: intent,
    supervisor_approved: approved,
    supervisor_warnings: warnings,
    final_prompt: refinedPrompt,
    reference_count: referenceUrls.length,
    model: 'gemini-3-pro-image-preview',
    pipeline_version: '6-agent-v2-gemini',
  };

  // Stage 5-6: Generate + Quality loop
  let currentPrompt = refinedPrompt;
  let imageUrl = '';
  let attempt = 0;
  let qualityResult: any = null;

  while (attempt <= maxRetries) {
    attempt++;
    console.log(`[PIPELINE] Attempt ${attempt}/${maxRetries + 1}`);

    const inputImages = productMatch
      ? [getMediaPublicUrl(supabaseUrl, productMatch.file_path), ...referenceUrls.filter(u => u !== getMediaPublicUrl(supabaseUrl, productMatch.file_path))]
      : referenceUrls;

    let genPrompt = currentPrompt;
    if (productMatch) {
      genPrompt = `CRITICAL: The first reference image is the EXACT product. Keep it UNCHANGED. ONLY change environment/background/lighting.\n\n${currentPrompt}`;
    }

    const { imageBase64 } = await geminiImageGenerate({
      prompt: genPrompt,
      inputImageUrls: inputImages.length > 0 ? inputImages.slice(0, 4) : undefined,
    });

    if (!imageBase64) throw new Error('No image generated');

    imageUrl = await uploadBase64ToStorage(supabase, supabaseUrl, imageBase64, companyId);

    qualityResult = await qualityAssessmentAgent(imageUrl, userPrompt, currentPrompt, companyName, productMatch);

    pipelineData[`attempt_${attempt}`] = { score: qualityResult.score, pass: qualityResult.pass, issues: qualityResult.issues };

    if (qualityResult.pass) {
      console.log(`[PIPELINE] PASSED (${qualityResult.score}/10) on attempt ${attempt}`);
      break;
    }

    if (attempt <= maxRetries && qualityResult.retryPrompt) {
      console.log(`[PIPELINE] FAILED (${qualityResult.score}/10), retrying...`);
      currentPrompt = `${currentPrompt}\n\nIMPROVEMENTS: ${qualityResult.retryPrompt}\nFIX: ${qualityResult.issues.join('; ')}`;
    } else break;
  }

  pipelineData.final_score = qualityResult?.score || 0;
  pipelineData.total_attempts = attempt;
  console.log('[PIPELINE] === Pipeline Complete ===');

  return { imageUrl, enhancedPrompt: currentPrompt, pipelineData };
}

// ============================================================
// MAIN SERVER
// ============================================================
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { companyId, prompt, productImageId, useProductMode } = await req.json();

    if (!companyId || !prompt) {
      return new Response(
        JSON.stringify({ error: "companyId and prompt are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid authentication" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get company
    const { data: company, error: companyError } = await supabase
      .from("companies").select("id, name, business_type").eq("id", companyId).single();
    if (companyError || !company) {
      return new Response(JSON.stringify({ error: "Company not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get settings context
    const { data: settings } = await supabase
      .from("image_generation_settings").select("*").eq("company_id", companyId).single();

    let contextParts: string[] = [];
    if (settings?.business_context) contextParts.push(`Business context: ${settings.business_context}`);
    if (settings?.style_description) contextParts.push(`Style: ${settings.style_description}`);
    const contextInfo = contextParts.join(". ");

    // Resolve product image
    let productImage: ProductImage | null = null;
    
    if (productImageId) {
      const { data: product } = await supabase
        .from("company_media").select("id, file_path, file_name, description, tags")
        .eq("id", productImageId).eq("company_id", companyId).single();
      if (product) productImage = product;
    } else if (useProductMode) {
      const { data: products } = await supabase
        .from("company_media").select("id, file_path, file_name, description, tags")
        .eq("company_id", companyId).eq("category", "products").eq("media_type", "image")
        .order("created_at", { ascending: false }).limit(1);
      if (products?.length > 0) productImage = products[0];
    }

    console.log(`[test-image-gen] Company: ${company.name}, Prompt: ${prompt}, Product: ${productImage?.file_name || 'none'}`);

    try {
      // === RUN 6-AGENT PIPELINE ===
      const result = await runImagePipeline(
        supabase, supabaseUrl, companyId,
        prompt, company.name, company.business_type || 'business',
        productImage, contextInfo
      );

      // Save to DB
      const savedPrompt = productImage ? `[Product: ${productImage.file_name}] ${prompt}` : prompt;
      const { data: savedImage, error: saveError } = await supabase
        .from("generated_images")
        .insert({
          company_id: companyId,
          prompt: savedPrompt,
          image_url: result.imageUrl,
          status: 'draft',
          brand_assets_used: productImage ? [productImage.id] : [],
          generation_params: result.pipelineData
        })
        .select().single();

      if (saveError) console.error("[test-image-gen] Save error:", saveError);

      return new Response(
        JSON.stringify({
          success: true,
          image_url: result.imageUrl,
          image_id: savedImage?.id,
          prompt,
          enhanced_prompt: result.enhancedPrompt,
          product_mode: !!productImage,
          product_used: productImage ? { id: productImage.id, name: productImage.file_name, description: productImage.description } : null,
          pipeline: {
            version: result.pipelineData.pipeline_version,
            quality_score: result.pipelineData.final_score,
            attempts: result.pipelineData.total_attempts,
            supervisor_approved: result.pipelineData.supervisor_approved,
            warnings: result.pipelineData.supervisor_warnings,
            intent: result.pipelineData.optimizer_intent,
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (genError: any) {
      console.error("[test-image-gen] Generation error:", genError);
      if (genError.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: genError.message || "Failed to generate image" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch (error) {
    console.error("[test-image-gen] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
