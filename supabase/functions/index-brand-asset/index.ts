import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VISION_PROMPT = `Analyze this product/brand image in detail for indexing purposes.

Return a JSON object with:
- "description": A detailed 1-2 sentence description of the product. Include: brand name visible on packaging/labels, product type, flavor/variant, size/volume, dominant colors, and any text visible on the product.
- "tags": An array of 5-10 keyword tags for search matching. Include: brand name, product category, flavor, color, size, packaging type (bottle, can, box, sachet, etc.), and any other distinguishing features.

Be specific about what you SEE. Include all readable text, brand names, and visual details.
Return ONLY valid JSON, no markdown.`;

async function analyzeImageBase64(base64: string, mimeType: string): Promise<{ description: string; tags: string[] }> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: VISION_PROMPT },
          { inlineData: { mimeType, data: base64 } }
        ]
      }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini ${response.status}: ${errText.substring(0, 200)}`);
  }

  const data = await response.json();
  console.log('[INDEX] Raw Gemini response:', JSON.stringify(data).substring(0, 500));
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  console.log('[INDEX] Extracted text:', text.substring(0, 300));
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON in response. Text was: "${text.substring(0, 200)}"`);
  return JSON.parse(jsonMatch[0]);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { media_id, company_id } = await req.json();
    if (!media_id || !company_id) throw new Error('media_id and company_id are required');

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: media, error: mediaError } = await supabase
      .from('company_media')
      .select('id, file_path, file_name')
      .eq('id', media_id).eq('company_id', company_id).single();

    if (mediaError || !media) throw new Error(`Media not found: ${mediaError?.message}`);

    const { data: fileData, error: dlError } = await supabase.storage
      .from('company-media').download(media.file_path);

    if (dlError || !fileData) throw new Error(`Download failed: ${dlError?.message}`);

    const base64 = encodeBase64(new Uint8Array(await fileData.arrayBuffer()));
    const mimeType = fileData.type || 'image/png';
    console.log(`[INDEX] Analyzing: ${media.file_name} (${(base64.length / 1024).toFixed(0)}KB)`);

    const result = await analyzeImageBase64(base64, mimeType);

    await supabase.from('company_media')
      .update({ description: result.description, tags: result.tags })
      .eq('id', media_id);

    console.log(`[INDEX] ✓ "${result.description}" [${result.tags.length} tags]`);

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[INDEX] Error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
