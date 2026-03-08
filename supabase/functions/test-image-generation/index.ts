import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { geminiImageGenerate } from "../_shared/gemini-client.ts";

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

// Upload base64 image to Supabase storage and return public URL
async function uploadBase64ToStorage(
  supabase: any,
  supabaseUrl: string,
  base64Data: string,
  companyId: string
): Promise<string> {
  // Extract the base64 content and mime type
  const matches = base64Data.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!matches) {
    console.error('[UPLOAD] Invalid base64 format');
    throw new Error('Invalid base64 image format');
  }
  
  const imageType = matches[1]; // png, jpeg, etc.
  const base64Content = matches[2];
  
  // Decode base64 to binary
  const binaryData = base64Decode(base64Content);
  
  // Generate unique filename
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(2, 10);
  const fileName = `generated/${companyId}/${timestamp}_${randomId}.${imageType}`;
  
  console.log(`[UPLOAD] Uploading to company-media/${fileName}`);
  
  // Upload to storage
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
  
  // Return public URL
  const publicUrl = `${supabaseUrl}/storage/v1/object/public/company-media/${fileName}`;
  console.log(`[UPLOAD] Success! Public URL: ${publicUrl.substring(0, 80)}...`);
  
  return publicUrl;
}

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

    // Initialize Supabase client with auth
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get auth header and verify admin role
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify user is admin
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if user is admin using has_role function
    const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
      _user_id: user.id,
      _role: "admin"
    });

    if (roleError || !isAdmin) {
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get company info
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id, name, business_type")
      .eq("id", companyId)
      .single();

    if (companyError || !company) {
      return new Response(
        JSON.stringify({ error: "Company not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get image generation settings for this company
    const { data: settings } = await supabase
      .from("image_generation_settings")
      .select("*")
      .eq("company_id", companyId)
      .single();

    // Build context
    let contextParts: string[] = [];
    if (settings) {
      if (settings.business_context) {
        contextParts.push(`Business context: ${settings.business_context}`);
      }
      if (settings.style_description) {
        contextParts.push(`Style: ${settings.style_description}`);
      }
    }
    const context = contextParts.join(". ");

    // Check if we should use product-anchored mode
    let productImage: ProductImage | null = null;
    let productImageUrl: string | null = null;
    
    if (productImageId) {
      // Specific product selected
      const { data: product } = await supabase
        .from("company_media")
        .select("id, file_path, file_name, description, tags")
        .eq("id", productImageId)
        .eq("company_id", companyId)
        .single();
      
      if (product) {
        productImage = product;
        productImageUrl = `${supabaseUrl}/storage/v1/object/public/company-media/${product.file_path}`;
      }
    } else if (useProductMode) {
      // Auto-select a product image
      const { data: products } = await supabase
        .from("company_media")
        .select("id, file_path, file_name, description, tags")
        .eq("company_id", companyId)
        .eq("category", "products")
        .eq("media_type", "image")
        .order("created_at", { ascending: false })
        .limit(1);
      
      if (products && products.length > 0) {
        productImage = products[0];
        productImageUrl = `${supabaseUrl}/storage/v1/object/public/company-media/${products[0].file_path}`;
      }
    }

    console.log(`[test-image-generation] Generating image for company ${company.name}`);
    console.log(`[test-image-generation] Original prompt: ${prompt}`);
    console.log(`[test-image-generation] Product mode: ${!!productImage}`);
    if (productImage) {
      console.log(`[test-image-generation] Using product: ${productImage.file_name}`);
    }

    // Using Gemini client

    let enhancedPrompt: string;
    let inputImageUrls: string[] = [];

    if (productImage && productImageUrl) {
      // PRODUCT-ANCHORED MODE
      const productDescription = productImage.description || productImage.file_name || 'this product';
      const productTags = productImage.tags?.join(', ') || '';
      
      enhancedPrompt = `CRITICAL BRANDING INSTRUCTIONS:
You are placing an EXACT product into a new environment. The product shown in the image MUST remain UNCHANGED.

PRODUCT DETAILS:
- Product: ${productDescription}
- Tags: ${productTags}
- Company: ${company.name}

STRICT RULES:
1. Do NOT change the product's label, text, logo, or branding
2. Do NOT alter the product's colors, shape, or proportions
3. Do NOT substitute with a different or generic product
4. ONLY change the background, lighting, shadows, and environment
5. Keep the product as the clear focal point
6. Maintain professional quality suitable for social media

ENVIRONMENT REQUEST:
${prompt}

${context}

Place THIS EXACT product into the requested environment while preserving ALL branding elements.`;

      inputImageUrls = [productImageUrl];
    } else {
      // TEXT-ONLY MODE
      enhancedPrompt = context 
        ? `${context}. User request: ${prompt}` 
        : `Generate a professional, high-quality image for a business: ${prompt}`;
    }

    console.log(`[test-image-generation] Enhanced prompt (first 300 chars): ${enhancedPrompt.substring(0, 300)}`);

    try {
      const { imageBase64, text: imageText } = await geminiImageGenerate({
        model: 'gemini-3-pro-image-preview',
        prompt: enhancedPrompt,
        inputImageUrls: inputImageUrls.length > 0 ? inputImageUrls : undefined,
      });

      if (!imageBase64) {
        console.error("[test-image-generation] No image returned from Gemini");
        return new Response(
          JSON.stringify({ error: "No image generated" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("[test-image-generation] Image generated, uploading to storage...");
      
      // Upload base64 to storage and get public URL
      const imageUrl = await uploadBase64ToStorage(supabase, supabaseUrl, imageBase64, companyId);
      
      console.log("[test-image-generation] Image uploaded successfully:", imageUrl.substring(0, 80));

    // Save the generated image to the database as a draft
    const savedPrompt = productImage 
      ? `[Product: ${productImage.file_name}] ${prompt}`
      : prompt;
    
    const brandAssetsUsed = productImage ? [productImage.id] : [];
    const generationParams = {
      original_prompt: prompt,
      enhanced_prompt: enhancedPrompt,
      product_mode: !!productImage,
      product_id: productImage?.id || null,
      model: "gemini-3-pro-image-preview",
      context: context || null
    };
    
    const { data: savedImage, error: saveError } = await supabase
      .from("generated_images")
      .insert({
        company_id: companyId,
        prompt: savedPrompt,
        image_url: imageUrl,
        status: 'draft', // Always save as draft
        brand_assets_used: brandAssetsUsed,
        generation_params: generationParams
      })
      .select()
      .single();

    if (saveError) {
      console.error("[test-image-generation] Failed to save image:", saveError);
      // Still return the image even if save fails
    }

    return new Response(
      JSON.stringify({
        success: true,
        image_url: imageUrl,
        image_id: savedImage?.id,
        prompt: prompt,
        enhanced_prompt: enhancedPrompt,
        product_mode: !!productImage,
        product_used: productImage ? {
          id: productImage.id,
          name: productImage.file_name,
          description: productImage.description
        } : null
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[test-image-generation] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
