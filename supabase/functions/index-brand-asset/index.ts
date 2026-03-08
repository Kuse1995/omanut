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
    const { media_id, company_id } = await req.json();
    if (!media_id || !company_id) {
      throw new Error('media_id and company_id are required');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch the media record
    const { data: media, error: mediaError } = await supabase
      .from('company_media')
      .select('id, file_path, file_name, description, tags, category')
      .eq('id', media_id)
      .eq('company_id', company_id)
      .single();

    if (mediaError || !media) {
      throw new Error(`Media not found: ${mediaError?.message}`);
    }

    // Get the public URL for the image
    const imageUrl = `${supabaseUrl}/storage/v1/object/public/company-media/${media.file_path}`;
    console.log(`[INDEX] Analyzing image: ${media.file_name} -> ${imageUrl.substring(0, 80)}...`);

    // Send to Gemini Vision for analysis
    const response = await geminiChat({
      model: 'gemini-2.5-flash',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Analyze this product/brand image in detail for indexing purposes.

Return a JSON object with:
- "description": A detailed 1-2 sentence description of the product. Include: brand name visible on packaging/labels, product type, flavor/variant, size/volume, dominant colors, and any text visible on the product.
- "tags": An array of 5-10 keyword tags for search matching. Include: brand name, product category, flavor, color, size, packaging type (bottle, can, box, sachet, etc.), and any other distinguishing features.

Examples of good descriptions:
- "Mosi Lager beer in a green 330ml bottle with gold and white label featuring the Victoria Falls logo"
- "Finch Gin 750ml clear glass bottle with blue and gold label, premium craft gin"
- "Coca-Cola 500ml PET bottle with red label and white script logo"

Be specific about what you SEE. Include all readable text, brand names, and visual details.
Return ONLY valid JSON, no markdown.`
          },
          {
            type: 'image_url',
            image_url: { url: imageUrl }
          }
        ]
      }],
      temperature: 0.2,
      max_tokens: 500,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[INDEX] Gemini error (${response.status}):`, errText);
      throw new Error(`Vision API error: ${response.status}`);
    }

    const data = await response.json();
    const aiContent = data.choices?.[0]?.message?.content || '';
    console.log(`[INDEX] AI response:`, aiContent.substring(0, 200));

    // Parse JSON from response
    let result: { description: string; tags: string[] };
    try {
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON in response');
      }
    } catch (e) {
      console.error('[INDEX] Failed to parse AI response:', e);
      return new Response(JSON.stringify({ success: false, error: 'Failed to parse AI analysis' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update the media record
    const { error: updateError } = await supabase
      .from('company_media')
      .update({
        description: result.description,
        tags: result.tags,
      })
      .eq('id', media_id);

    if (updateError) {
      console.error('[INDEX] DB update error:', updateError);
      throw new Error(`Failed to update media: ${updateError.message}`);
    }

    console.log(`[INDEX] Successfully indexed: "${result.description}" with ${result.tags.length} tags`);

    return new Response(JSON.stringify({ 
      success: true, 
      description: result.description, 
      tags: result.tags 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[INDEX] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
