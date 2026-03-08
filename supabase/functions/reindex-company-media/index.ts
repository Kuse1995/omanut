import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { geminiChatJSON } from "../_shared/gemini-client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { company_id } = await req.json();
    if (!company_id) throw new Error('company_id is required');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: mediaItems, error } = await supabase
      .from('company_media')
      .select('id, file_path, file_name, description, tags, category')
      .eq('company_id', company_id)
      .eq('media_type', 'image')
      .or('description.is.null,description.eq.Product image for AI generation,description.eq.Media file,description.eq.')
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Query error: ${error.message}`);
    if (!mediaItems || mediaItems.length === 0) {
      return new Response(JSON.stringify({ success: true, indexed: 0, message: 'No images need re-indexing' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[REINDEX] Found ${mediaItems.length} images to re-index for company ${company_id}`);

    let indexed = 0;
    const errors: string[] = [];

    for (const media of mediaItems) {
      try {
        // Download image from storage
        const { data: fileData, error: dlError } = await supabase.storage
          .from('company-media')
          .download(media.file_path);

        if (dlError || !fileData) {
          errors.push(`${media.file_name}: Download failed - ${dlError?.message}`);
          continue;
        }

        const base64 = encodeBase64(new Uint8Array(await fileData.arrayBuffer()));
        const mimeType = fileData.type || 'image/png';

        const data = await geminiChatJSON({
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

Be specific about what you SEE. Include all readable text, brand names, and visual details.
Return ONLY valid JSON, no markdown.`
              },
              {
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${base64}` }
              }
            ]
          }],
          temperature: 0.2,
          max_tokens: 500,
        });

        const aiContent = data.choices?.[0]?.message?.content || '';
        const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
        
        if (!jsonMatch) {
          errors.push(`${media.file_name}: No JSON in response`);
          continue;
        }

        const result = JSON.parse(jsonMatch[0]);

        await supabase
          .from('company_media')
          .update({ description: result.description, tags: result.tags })
          .eq('id', media.id);

        console.log(`[REINDEX] ✓ ${media.file_name}: "${result.description}"`);
        indexed++;

        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        errors.push(`${media.file_name}: ${e instanceof Error ? e.message : 'Unknown'}`);
      }
    }

    console.log(`[REINDEX] Complete: ${indexed}/${mediaItems.length} indexed, ${errors.length} errors`);

    return new Response(JSON.stringify({ 
      success: true, total: mediaItems.length, indexed, 
      errors: errors.length > 0 ? errors : undefined 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[REINDEX] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
