import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";
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
    const { imageDataUrl, fileName, fileType, businessType } = await req.json();

    if (!imageDataUrl) {
      throw new Error('Image data is required');
    }

    console.log('Analyzing media with AI:', fileName, fileType);

    // Prepare the prompt based on business type
    const systemPrompt = `You are an AI assistant that analyzes images for a ${businessType || 'business'}.
Your task is to suggest:
1. The most appropriate category from: menu, interior, exterior, logo, products, promotional, staff, events, facilities, other
2. A concise description (1-2 sentences) of what the image shows
3. Relevant tags (3-5 comma-separated keywords)

Return your response as JSON with this exact structure:
{
  "category": "one of the categories",
  "description": "brief description",
  "tags": ["tag1", "tag2", "tag3"]
}`;

    const userPrompt = `Analyze this image from a ${businessType || 'business'} and suggest the appropriate category, description, and tags.`;

    // Call Gemini AI with vision
    const response = await geminiChat({
      model: 'gemini-3-flash-preview',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            { type: 'image_url', image_url: { url: imageDataUrl } }
          ]
        }
      ],
      temperature: 0.3,
      max_tokens: 500
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini AI error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ 
          error: 'Rate limit exceeded. Please try again in a moment.' 
        }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      throw new Error(`AI API error: ${response.status}`);
    }

    const aiData = await response.json();
    const aiResponse = aiData.choices[0].message.content;

    console.log('AI response:', aiResponse);

    // Parse the JSON response
    let suggestions;
    try {
      // Try to extract JSON from the response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        suggestions = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      // Fallback to default suggestions
      suggestions = {
        category: 'other',
        description: 'Media file',
        tags: ['general']
      };
    }

    return new Response(JSON.stringify(suggestions), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in analyze-media function:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      fallback: {
        category: 'other',
        description: 'Unable to analyze - please add details manually',
        tags: []
      }
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});