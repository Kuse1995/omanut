import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
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
    const { company_name, industry_hint } = await req.json();

    if (!company_name || company_name.trim() === '') {
      return new Response(
        JSON.stringify({ error: 'Company name is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[RESEARCH] Starting research for: ${company_name}`);

    // Using Gemini client

    // Research prompt for AI
    const researchPrompt = `You are a business research assistant helping to set up an AI customer service system for a company.

Company to research: "${company_name}"
${industry_hint ? `Industry hint: ${industry_hint}` : ''}

Research this company and provide detailed, structured information. If you cannot find specific information about this exact company:
1. Identify the likely industry/business type from the company name
2. Research similar businesses in that industry  
3. Provide industry-standard configurations and best practices

Provide comprehensive information for these fields:

1. **business_type**: The industry category. Choose from: restaurant, clinic, gym, salon, hotel, spa, or provide a custom type
2. **voice_style**: How the AI assistant should communicate (tone, personality, communication style)
3. **hours**: Typical operating hours (format: "Mon-Fri 09:00 - 17:00, Sat 10:00 - 14:00")
4. **services**: Main services, products, or offerings (comma-separated list)
5. **branches**: Branch names if multiple locations (comma-separated)
6. **service_locations**: Physical areas or service zones within the business (comma-separated, e.g., "outdoor,indoor,VIP")
7. **quick_reference_info**: Important facts customers should know - history, specialties, unique features, awards, policies (2-3 sentences)
8. **system_instructions**: Detailed instructions for the AI assistant on how to handle customer inquiries, what to prioritize, special considerations (2-3 sentences)
9. **qa_style**: How to answer questions - brief/detailed, formal/casual, technical/simple language
10. **banned_topics**: Topics the AI should avoid or redirect to human staff (comma-separated)

Also provide:
- **confidence_score**: 0-100 indicating reliability (80-100: verified company data, 50-79: estimated from industry standards, 0-49: generic defaults)
- **research_summary**: 1-2 sentences explaining what data sources were found and how reliable the information is

Return ONLY valid JSON with this exact structure:
{
  "business_type": "string",
  "voice_style": "string",
  "hours": "string",
  "services": "string",
  "branches": "string",
  "service_locations": "string",
  "quick_reference_info": "string",
  "system_instructions": "string",
  "qa_style": "string",
  "banned_topics": "string",
  "confidence_score": number,
  "research_summary": "string"
}`;

    // Call Lovable AI for research
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          {
            role: 'system',
            content: 'You are a business research assistant. Always return valid JSON only, no markdown formatting.'
          },
          {
            role: 'user',
            content: researchPrompt
          }
        ],
        temperature: 0.7,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'AI rate limit exceeded. Please try again in a moment.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI credits exhausted. Please add credits to your Lovable workspace.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const errorText = await aiResponse.text();
      console.error('[RESEARCH] AI API error:', aiResponse.status, errorText);
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices?.[0]?.message?.content || '';
    
    console.log('[RESEARCH] Raw AI response:', aiContent.substring(0, 200));

    // Parse AI response - remove markdown formatting if present
    let cleanContent = aiContent.trim();
    if (cleanContent.startsWith('```json')) {
      cleanContent = cleanContent.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent.replace(/```\n?/g, '');
    }

    let researchData;
    try {
      researchData = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error('[RESEARCH] Failed to parse AI response:', parseError);
      console.error('[RESEARCH] Content was:', cleanContent);
      throw new Error('Failed to parse AI research results');
    }

    // Validate required fields
    const requiredFields = ['business_type', 'voice_style', 'hours', 'services'];
    const missingFields = requiredFields.filter(field => !researchData[field]);
    
    if (missingFields.length > 0) {
      console.warn('[RESEARCH] Missing fields:', missingFields);
      // Fill in defaults for missing fields
      if (!researchData.business_type) researchData.business_type = 'other';
      if (!researchData.voice_style) researchData.voice_style = 'Professional and helpful';
      if (!researchData.hours) researchData.hours = 'Mon-Fri 09:00 - 17:00';
      if (!researchData.services) researchData.services = 'Various services available';
    }

    // Ensure all fields exist with defaults
    const completeData = {
      business_type: researchData.business_type || 'other',
      voice_style: researchData.voice_style || 'Professional and helpful',
      hours: researchData.hours || 'Mon-Fri 09:00 - 17:00',
      services: researchData.services || 'Various services available',
      branches: researchData.branches || 'Main',
      service_locations: researchData.service_locations || 'main area',
      quick_reference_info: researchData.quick_reference_info || '',
      system_instructions: researchData.system_instructions || '',
      qa_style: researchData.qa_style || 'Clear and concise responses',
      banned_topics: researchData.banned_topics || '',
      confidence_score: Math.min(100, Math.max(0, researchData.confidence_score || 50)),
      research_summary: researchData.research_summary || 'Research completed with available information'
    };

    console.log('[RESEARCH] Completed successfully:', {
      company: company_name,
      business_type: completeData.business_type,
      confidence: completeData.confidence_score
    });

    return new Response(
      JSON.stringify({
        success: true,
        data: completeData
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('[RESEARCH] Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Research failed',
        details: 'Please try again or fill in the fields manually'
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
