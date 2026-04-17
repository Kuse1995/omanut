import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { geminiImageGenerate } from "../_shared/gemini-client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getMediaPublicUrl(supabaseUrl: string, filePath: string): string {
  return `${supabaseUrl}/storage/v1/object/public/company-media/${filePath}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const {
      prompt,
      conversationId,
      reference_image_ids,
      reference_image_urls,
      auto_select_products = true,
      // Allow service-to-service callers (e.g. MCP) to pass the company explicitly.
      // Falls back to the authenticated user's company.
      company_id: explicitCompanyId,
    } = body || {};

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: 'Prompt is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Resolve company_id: explicit (service-role/MCP path) → otherwise via auth user
    let companyId: string | null = explicitCompanyId || null;
    if (!companyId) {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) {
        return new Response(JSON.stringify({ error: 'Authorization required' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const { data: userData } = await supabase
        .from('users')
        .select('company_id')
        .eq('id', user.id)
        .single();
      if (!userData?.company_id) {
        return new Response(JSON.stringify({ error: 'User not associated with a company' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      companyId = userData.company_id;
    }

    // Get image generation settings
    const { data: settings } = await supabase
      .from('image_generation_settings')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle();

    if (!settings?.enabled) {
      return new Response(
        JSON.stringify({ error: 'Image generation is not enabled for this company' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get company info for context
    const { data: company } = await supabase
      .from('companies')
      .select('business_type, name')
      .eq('id', companyId)
      .single();

    // ────────────────────────────────────────────────────────────
    // ASSEMBLE REFERENCE IMAGES (visual anchors for Gemini)
    // Priority order:
    //   1. Explicit URLs passed in the request
    //   2. Explicit media IDs passed in the request
    //   3. image_generation_settings.reference_asset_ids (operator-saved anchors)
    //   4. Auto-pull: 1 logo + up to 3 most-recent product photos
    // Cap at 4 inputs (Gemini limit used elsewhere in the codebase).
    // ────────────────────────────────────────────────────────────
    const referencesUsed: Array<{ source: string; id?: string; url: string; file_name?: string }> = [];
    const inputImageUrls: string[] = [];
    const seen = new Set<string>();

    const pushUrl = (source: string, url: string, id?: string, file_name?: string) => {
      if (!url || seen.has(url) || inputImageUrls.length >= 4) return;
      seen.add(url);
      inputImageUrls.push(url);
      referencesUsed.push({ source, id, url, file_name });
    };

    // 1. Explicit URLs
    if (Array.isArray(reference_image_urls)) {
      for (const u of reference_image_urls) pushUrl('explicit_url', u);
    }

    // 2. Explicit media IDs
    if (Array.isArray(reference_image_ids) && reference_image_ids.length > 0 && inputImageUrls.length < 4) {
      const { data: explicitMedia } = await supabase
        .from('company_media')
        .select('id, file_path, file_name')
        .eq('company_id', companyId)
        .in('id', reference_image_ids);
      if (explicitMedia) {
        // Preserve caller order
        const byId = new Map(explicitMedia.map((m: any) => [m.id, m]));
        for (const id of reference_image_ids) {
          const m: any = byId.get(id);
          if (m) pushUrl('explicit_media_id', getMediaPublicUrl(supabaseUrl, m.file_path), m.id, m.file_name);
        }
      }
    }

    // 3. Saved reference_asset_ids
    const savedRefIds: string[] = Array.isArray(settings.reference_asset_ids) ? settings.reference_asset_ids : [];
    if (savedRefIds.length > 0 && inputImageUrls.length < 4) {
      const { data: savedMedia } = await supabase
        .from('company_media')
        .select('id, file_path, file_name')
        .eq('company_id', companyId)
        .in('id', savedRefIds);
      if (savedMedia) {
        const byId = new Map(savedMedia.map((m: any) => [m.id, m]));
        for (const id of savedRefIds) {
          const m: any = byId.get(id);
          if (m) pushUrl('saved_reference_asset', getMediaPublicUrl(supabaseUrl, m.file_path), m.id, m.file_name);
        }
      }
    }

    // 4. Auto-select logo + recent products
    if (auto_select_products && inputImageUrls.length < 4) {
      const [{ data: logos }, { data: products }] = await Promise.all([
        supabase.from('company_media')
          .select('id, file_path, file_name')
          .eq('company_id', companyId)
          .eq('category', 'logo')
          .eq('media_type', 'image')
          .order('created_at', { ascending: false })
          .limit(1),
        supabase.from('company_media')
          .select('id, file_path, file_name')
          .eq('company_id', companyId)
          .eq('category', 'products')
          .eq('media_type', 'image')
          .order('created_at', { ascending: false })
          .limit(3),
      ]);
      if (logos) for (const l of logos) pushUrl('auto_logo', getMediaPublicUrl(supabaseUrl, l.file_path), l.id, l.file_name);
      if (products) for (const p of products) pushUrl('auto_product', getMediaPublicUrl(supabaseUrl, p.file_path), p.id, p.file_name);
    }

    const hasProductAnchor = referencesUsed.some(
      r => r.source === 'explicit_media_id' || r.source === 'saved_reference_asset' || r.source === 'auto_product' || r.source === 'explicit_url'
    );

    // ────────────────────────────────────────────────────────────
    // BUILD ENHANCED PROMPT
    // ────────────────────────────────────────────────────────────
    let enhancedPrompt = prompt;
    const contextText = settings.business_context || settings.style_description;
    if (contextText) {
      enhancedPrompt = `${contextText}. ${prompt}`;
    }
    if (settings.style_description && settings.business_context) {
      enhancedPrompt += `. Style: ${settings.style_description}`;
    }
    enhancedPrompt += `. Ultra high resolution, professional ${company?.business_type || 'business'} image.`;

    // HARD GEOMETRY LOCK preamble when we have product anchors (mirrors whatsapp-image-gen)
    let genPrompt = enhancedPrompt;
    if (hasProductAnchor && inputImageUrls.length > 0) {
      genPrompt =
        `HARD GEOMETRY LOCK — The first reference image is the EXACT product (ground truth). MANDATORY CONSTRAINTS:\n` +
        `• Preserve the label layout PIXEL-FOR-PIXEL — same text positions, same font sizes, same section arrangement\n` +
        `• Maintain EXACT color hex codes from the product — no tinting, no color shifting\n` +
        `• Logo must be reproduced with ZERO distortion — no warping, no stretching\n` +
        `• Packaging form factor is IMMUTABLE — same shape, proportions, dimensions\n` +
        `• You may ONLY change: environment, background, lighting, camera angle, surrounding context\n` +
        `• ANY deviation from the product reference = FAILURE\n\n${enhancedPrompt}`;
    }

    console.log(`[GENERATE-BUSINESS-IMAGE] company=${companyId} refs=${inputImageUrls.length} hasAnchor=${hasProductAnchor}`);
    console.log(`[GENERATE-BUSINESS-IMAGE] Sources: ${referencesUsed.map(r => r.source).join(', ') || 'none'}`);

    // ────────────────────────────────────────────────────────────
    // CALL GEMINI
    // ────────────────────────────────────────────────────────────
    const { imageBase64 } = await geminiImageGenerate({
      prompt: genPrompt,
      inputImageUrls: inputImageUrls.length > 0 ? inputImageUrls : undefined,
    });

    if (!imageBase64) {
      throw new Error('No image generated');
    }

    // Upload to storage
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    const filePath = `generated/${companyId}/${crypto.randomUUID()}.png`;

    const { error: uploadError } = await supabase.storage
      .from('company-media')
      .upload(filePath, binaryData, { contentType: 'image/png', upsert: false });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      throw new Error('Failed to upload generated image');
    }

    const { data: publicData } = supabase.storage.from('company-media').getPublicUrl(filePath);
    const imageUrl = publicData.publicUrl;

    // Save generated image record
    const { data: savedImage, error: saveError } = await supabase
      .from('generated_images')
      .insert({
        company_id: companyId,
        conversation_id: conversationId || null,
        prompt: prompt,
        image_url: imageUrl,
      })
      .select()
      .single();

    if (saveError) {
      console.error('Error saving image record:', saveError);
    }

    return new Response(
      JSON.stringify({
        image_url: imageUrl,
        image_id: savedImage?.id,
        references_used: referencesUsed,
        reference_count: inputImageUrls.length,
        has_product_anchor: hasProductAnchor,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating image:', error);
    const message = error instanceof Error ? error.message : 'An error occurred processing your request';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
