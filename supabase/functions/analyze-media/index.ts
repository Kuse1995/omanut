import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { geminiChat } from "../_shared/gemini-client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function extractBmsFields(raw: string): { bms_product_id?: string; matched_product_name?: string } {
  const result: { bms_product_id?: string; matched_product_name?: string } = {};
  const idMatch = raw.match(/"bms_product_id"\s*:\s*"([^"]+)"/);
  if (idMatch) result.bms_product_id = idMatch[1];
  const nameMatch = raw.match(/"matched_product_name"\s*:\s*"([^"]+)"/);
  if (nameMatch) result.matched_product_name = nameMatch[1];
  return result;
}

function robustJsonParse(raw: string): any {
  // Strip markdown code fences
  let cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

  // Try direct parse
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (_e) {
      // Try repairing truncated JSON
      let attempt = jsonMatch[0];
      // Close open strings
      const quoteCount = (attempt.match(/"/g) || []).length;
      if (quoteCount % 2 !== 0) attempt += '"';
      // Close open arrays
      const openBrackets = (attempt.match(/\[/g) || []).length - (attempt.match(/\]/g) || []).length;
      for (let i = 0; i < openBrackets; i++) attempt += ']';
      // Close open objects
      const openBraces = (attempt.match(/\{/g) || []).length - (attempt.match(/\}/g) || []).length;
      for (let i = 0; i < openBraces; i++) attempt += '}';
      try {
        return JSON.parse(attempt);
      } catch (_e2) {
        // fall through
      }
    }
  }

  // Last resort: extract individual fields via regex
  const partial: any = {};
  const catMatch = cleaned.match(/"category"\s*:\s*"([^"]+)"/);
  if (catMatch) partial.category = catMatch[1];
  const descMatch = cleaned.match(/"description"\s*:\s*"([^"]+)"/);
  if (descMatch) partial.description = descMatch[1];
  const bms = extractBmsFields(cleaned);
  if (bms.bms_product_id) partial.bms_product_id = bms.bms_product_id;
  if (bms.matched_product_name) partial.matched_product_name = bms.matched_product_name;

  if (Object.keys(partial).length > 0) return partial;
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageDataUrl, fileName, fileType, businessType, bmsProducts } = await req.json();

    if (!imageDataUrl) {
      throw new Error('Image data is required');
    }

    console.log('Analyzing media with AI:', fileName, fileType);

    // Build BMS context if available
    const bmsContext = Array.isArray(bmsProducts) && bmsProducts.length > 0
      ? `\n\nKnown BMS inventory products:\n${bmsProducts.map((p: any) => `- ID: "${p.id}", Name: "${p.name}"`).join('\n')}\n\nIf the image clearly matches one of these products, include "bms_product_id" (the matching product ID) and "matched_product_name" in your response.`
      : '';

    // Prepare the prompt based on business type
    const systemPrompt = `You are an AI assistant that analyzes images for a ${businessType || 'business'}.
Your task is to suggest:
1. The most appropriate category from: menu, interior, exterior, logo, products, promotional, staff, events, facilities, other
2. A concise description (1-2 sentences) of what the image shows
3. Relevant tags (3-5 comma-separated keywords)
4. A suggested product name based on visible labels, text, or visual cues${bmsContext}

Return your response as a valid JSON object (no markdown, no code fences) with this exact structure:
{
  "category": "one of the categories",
  "description": "brief description",
  "tags": ["tag1", "tag2", "tag3"],
  "suggested_product_name": "name if identifiable or null",
  "bms_product_id": "matched BMS product ID or null",
  "matched_product_name": "matched BMS product name or null"
}`;

    const userPrompt = `Analyze this image from a ${businessType || 'business'} and suggest the appropriate category, description, and tags. Respond with ONLY the JSON object, no extra text.`;

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
      max_tokens: 1024
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

    // Parse the JSON response with robust handling
    let suggestions = robustJsonParse(aiResponse);

    if (!suggestions) {
      console.error('Failed to parse AI response, using fallback');
      // Still try to extract BMS fields from raw text
      const bmsFields = extractBmsFields(aiResponse);
      suggestions = {
        category: 'other',
        description: 'Media file',
        tags: ['general'],
        ...bmsFields
      };
    }

    // Ensure required fields exist
    if (!suggestions.category) suggestions.category = 'other';
    if (!suggestions.description) suggestions.description = 'Media file';
    if (!suggestions.tags || !Array.isArray(suggestions.tags)) suggestions.tags = ['general'];

    return new Response(JSON.stringify(suggestions), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in analyze-media function:', error);
    return new Response(JSON.stringify({ 
      error: 'An error occurred processing your request',
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
