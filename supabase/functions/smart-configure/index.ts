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
    const { company_id, business_overview } = await req.json();

    if (!business_overview || business_overview.trim() === '') {
      return new Response(
        JSON.stringify({ error: 'Business overview is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[SMART-CONFIG] Processing overview for company: ${company_id}`);
    console.log(`[SMART-CONFIG] Overview length: ${business_overview.length} chars`);

    // Using Gemini client

    // Initialize Supabase to fetch existing company data for context
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let existingConfig: any = {};
    if (company_id) {
      const { data: company } = await supabase
        .from('companies')
        .select('name, business_type, voice_style, hours, services, service_locations, quick_reference_info')
        .eq('id', company_id)
        .single();

      const { data: aiOverrides } = await supabase
        .from('company_ai_overrides')
        .select('system_instructions, qa_style, banned_topics')
        .eq('company_id', company_id)
        .single();

      existingConfig = { ...company, ...aiOverrides };
    }

    const configurePrompt = `You are an expert AI configuration specialist. Your task is to analyze a business overview and intelligently extract and organize information to optimize an AI customer service assistant.

CURRENT CONFIGURATION (for context, may be empty or partial):
${JSON.stringify(existingConfig, null, 2)}

BUSINESS OVERVIEW TO ANALYZE:
"""
${business_overview}
"""

Analyze the business overview and extract ALL relevant information. Organize it into the following categories. Only include fields where you found new/updated information - do not repeat existing config unless it should be updated.

IMPORTANT RULES:
1. For knowledge_base: Extract ALL factual information - products, prices, services, policies, hours, locations, contact info, FAQs, special procedures, payment methods, etc. Format as structured text with clear sections.
2. For system_instructions: Extract rules, protocols, escalation procedures, special handling instructions, restrictions, must-do behaviors.
3. For qa_style: Determine the appropriate tone - formal/casual, brief/detailed, industry-specific language.
4. For banned_topics: Identify topics the AI should avoid or redirect to human staff.
5. For hours: Extract operating hours in format "Mon-Fri 09:00 - 17:00, Sat 10:00 - 14:00"
6. For services: Comma-separated list of main services/products
7. For service_locations: Areas within the business (e.g., "outdoor,indoor,VIP lounge")
8. For voice_style: Brief description of personality/communication style
9. For business_type: Identify the industry category

For each field, also provide:
- confidence: 0-100 indicating how certain you are this info is correct
- source_excerpt: Brief quote from the overview that supports this

Return ONLY valid JSON with this structure:
{
  "extracted_fields": {
    "knowledge_base": {
      "value": "structured text with all extracted facts",
      "confidence": 90,
      "source_excerpt": "..."
    },
    "system_instructions": {
      "value": "...",
      "confidence": 85,
      "source_excerpt": "..."
    },
    "qa_style": {
      "value": "...",
      "confidence": 80,
      "source_excerpt": "..."
    },
    "banned_topics": {
      "value": "topic1, topic2",
      "confidence": 70,
      "source_excerpt": "..."
    },
    "hours": {
      "value": "...",
      "confidence": 95,
      "source_excerpt": "..."
    },
    "services": {
      "value": "...",
      "confidence": 90,
      "source_excerpt": "..."
    },
    "service_locations": {
      "value": "...",
      "confidence": 75,
      "source_excerpt": "..."
    },
    "voice_style": {
      "value": "...",
      "confidence": 85,
      "source_excerpt": "..."
    },
    "business_type": {
      "value": "...",
      "confidence": 90,
      "source_excerpt": "..."
    }
  },
  "optimization_suggestions": [
    "Suggestion 1 for improving AI performance",
    "Suggestion 2 for missing information that should be added"
  ],
  "summary": "Brief summary of what was extracted and configured"
}

Only include fields in extracted_fields if you found relevant information. Skip fields with no data.`;

    const aiResponse = await geminiChat({
      model: 'glm-4.7',
      messages: [
        {
          role: 'system',
          content: 'You are an AI configuration specialist. Extract and organize business information to optimize AI assistant performance. Always return valid JSON only, no markdown formatting.'
        },
        {
          role: 'user',
          content: configurePrompt
        }
      ],
      temperature: 0.3,
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'AI rate limit exceeded. Please try again in a moment.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const errorText = await aiResponse.text();
      console.error('[SMART-CONFIG] AI API error:', aiResponse.status, errorText);
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices?.[0]?.message?.content || '';
    
    console.log('[SMART-CONFIG] Raw AI response:', aiContent.substring(0, 300));

    // Parse AI response
    let cleanContent = aiContent.trim();
    if (cleanContent.startsWith('```json')) {
      cleanContent = cleanContent.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent.replace(/```\n?/g, '');
    }

    let configData;
    try {
      configData = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error('[SMART-CONFIG] Failed to parse AI response:', parseError);
      console.error('[SMART-CONFIG] Content was:', cleanContent);
      throw new Error('Failed to parse AI configuration results');
    }

    // Calculate overall confidence
    const fields = configData.extracted_fields || {};
    const confidences = Object.values(fields).map((f: any) => f.confidence || 0);
    const avgConfidence = confidences.length > 0 
      ? Math.round(confidences.reduce((a: number, b: number) => a + b, 0) / confidences.length)
      : 0;

    console.log('[SMART-CONFIG] Completed successfully:', {
      fieldsExtracted: Object.keys(fields).length,
      avgConfidence
    });

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          ...configData,
          overall_confidence: avgConfidence,
          fields_count: Object.keys(fields).length
        }
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('[SMART-CONFIG] Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Smart configuration failed',
        details: 'Please try again or configure fields manually'
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
