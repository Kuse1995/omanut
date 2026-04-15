import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { geminiChat } from "../_shared/gemini-client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );

    const { imageUrl, mediaId, companyId, productName, bmsProductNames } = await req.json();

    if (!imageUrl || !companyId || !productName) {
      return new Response(JSON.stringify({ error: 'imageUrl, companyId, and productName are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[EXTRACT-IDENTITY] Analyzing product: "${productName}" for company ${companyId}`);

    // Use Gemini Vision to extract structured visual fingerprint
    const systemPrompt = `You are a product visual identity analyst. Your job is to extract a precise visual fingerprint from a product image.

EXTRACT THE FOLLOWING with extreme precision:

1. COLORS: Extract ALL dominant colors as exact hex codes. Include:
   - Primary packaging color
   - Secondary/accent colors
   - Label background colors
   - Text colors
   - Logo colors

2. LABELS: Extract ALL visible text on the product verbatim:
   - Brand name
   - Product name
   - Taglines/slogans
   - Ingredient highlights
   - Volume/weight indicators
   - Any other text

3. SHAPE: Describe the packaging form factor precisely:
   - Container type (bottle, box, pouch, can, tube, jar, etc.)
   - Shape (cylindrical, rectangular, conical, etc.)
   - Key structural features (cap type, spout, handle, etc.)
   - Proportions (tall/short, wide/narrow)

4. DISTINGUISHING FEATURES: List unique visual elements:
   - Logo placement and description
   - Graphic elements (waves, lines, patterns)
   - Surface texture (matte, glossy, textured)
   - Special features (window, embossing, metallic elements)

Respond with RAW JSON only. No markdown, no code fences.
{
  "colors": [
    { "hex": "#FFFFFF", "name": "White", "location": "Label background" }
  ],
  "labels": ["exact text 1", "exact text 2"],
  "shape": "precise shape description",
  "distinguishing_features": ["feature 1", "feature 2"],
  "logo_description": "detailed logo description",
  "packaging_type": "bottle|box|can|pouch|tube|jar|other",
  "surface_finish": "matte|glossy|textured|metallic",
  "size_impression": "small|medium|large|extra-large",
  "suggested_product_name": "best matching product name from the available list, or your best guess based on visible text"
}${Array.isArray(bmsProductNames) && bmsProductNames.length > 0 ? `\n\nAvailable BMS products to match against: ${JSON.stringify(bmsProductNames)}` : ''}`;

    const response = await geminiChat({
      model: 'glm-4.7',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Extract the complete visual identity fingerprint for this product: "${productName}"` },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        }
      ],
      temperature: 0.1,
      max_tokens: 2000,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[EXTRACT-IDENTITY] Gemini error:', errText);
      throw new Error('Vision analysis failed');
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // Parse the response
    let fingerprint;
    try {
      let cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const jsonStart = cleaned.indexOf('{');
      const jsonEnd = cleaned.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
      }
      fingerprint = JSON.parse(cleaned);
    } catch (e) {
      console.error('[EXTRACT-IDENTITY] Parse error:', e, 'Raw:', content.substring(0, 500));
      throw new Error('Failed to parse visual fingerprint');
    }

    console.log(`[EXTRACT-IDENTITY] Extracted: ${fingerprint.colors?.length || 0} colors, ${fingerprint.labels?.length || 0} labels, shape: ${fingerprint.shape?.substring(0, 50)}`);

    // Upsert to product_identity_profiles
    const profileData: any = {
      company_id: companyId,
      product_name: productName,
      visual_fingerprint: fingerprint,
      description: `${fingerprint.packaging_type || 'product'}: ${fingerprint.shape || ''} - ${fingerprint.labels?.slice(0, 3).join(', ') || 'No labels'}`,
      is_active: true,
    };

    if (mediaId) {
      profileData.media_id = mediaId;
    }

    // Check if profile already exists for this media_id or product_name + company
    let existingId: string | null = null;
    if (mediaId) {
      const { data: existing } = await supabase
        .from('product_identity_profiles')
        .select('id')
        .eq('company_id', companyId)
        .eq('media_id', mediaId)
        .single();
      if (existing) existingId = existing.id;
    }

    if (!existingId) {
      const { data: existing } = await supabase
        .from('product_identity_profiles')
        .select('id')
        .eq('company_id', companyId)
        .eq('product_name', productName)
        .single();
      if (existing) existingId = existing.id;
    }

    let result;
    if (existingId) {
      profileData.updated_at = new Date().toISOString();
      const { data, error } = await supabase
        .from('product_identity_profiles')
        .update(profileData)
        .eq('id', existingId)
        .select()
        .single();
      if (error) throw error;
      result = data;
      console.log(`[EXTRACT-IDENTITY] Updated existing profile: ${existingId}`);
    } else {
      const { data, error } = await supabase
        .from('product_identity_profiles')
        .insert(profileData)
        .select()
        .single();
      if (error) throw error;
      result = data;
      console.log(`[EXTRACT-IDENTITY] Created new profile: ${result.id}`);
    }

    return new Response(JSON.stringify({ success: true, profile: result, fingerprint }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[EXTRACT-IDENTITY] Error:', error);
    return new Response(JSON.stringify({ error: 'An error occurred processing your request' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
