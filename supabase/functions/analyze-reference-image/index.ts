import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageUrls, companyName } = await req.json();
    
    if (!imageUrls || imageUrls.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No image URLs provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    console.log(`Analyzing ${imageUrls.length} reference images for ${companyName || 'company'}`);

    // Build image content array for the message
    const imageContent = imageUrls.slice(0, 5).map((url: string) => ({
      type: "image_url",
      image_url: { url }
    }));

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-pro-image-preview',
        messages: [
          {
            role: 'system',
            content: `You are an expert brand analyst and visual designer. Analyze the provided reference images to extract visual style preferences and suggest business context. Be concise and actionable.

Return a JSON object with this exact structure:
{
  "style_description": "A 1-2 sentence description of the visual style (colors, mood, composition, lighting)",
  "business_context": "A 1-2 sentence description of what the business appears to be and its target audience",
  "color_palette": ["primary color", "secondary color", "accent color"],
  "mood_keywords": ["keyword1", "keyword2", "keyword3"],
  "suggested_prompts": ["prompt suggestion 1", "prompt suggestion 2", "prompt suggestion 3"],
  "confidence": 0.85
}

Only return valid JSON, no markdown formatting.`
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Analyze these reference images for ${companyName || 'a business'} and extract visual style preferences, brand characteristics, and suggest business context. Focus on colors, mood, composition style, and what type of business this appears to be.`
              },
              ...imageContent
            ]
          }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI gateway error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI credits depleted. Please add credits to continue.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      throw new Error(`AI analysis failed: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      throw new Error('No analysis content received from AI');
    }

    console.log('Raw AI response:', content);

    // Parse the JSON response
    let analysis;
    try {
      // Remove any markdown code block formatting if present
      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysis = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', parseError);
      // Return a structured error with the raw content for debugging
      return new Response(
        JSON.stringify({ 
          error: 'Failed to parse AI analysis',
          raw_content: content 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Parsed analysis:', analysis);

    return new Response(
      JSON.stringify({ 
        success: true,
        analysis 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in analyze-reference-image:', error);
    const errorMessage = error instanceof Error ? error.message : 'Analysis failed';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
