import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY');
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    const {
      companyId,
      customerPhone,
      customerMessage,
      conversationHistory,
      companyData,
      customerData
    } = await req.json();

    console.log('[Supervisor] Analyzing interaction for:', customerPhone);

    // Fetch pattern analysis data
    const { data: pastConversations } = await supabase
      .from('conversations')
      .select(`
        *,
        messages(content, role, created_at)
      `)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(20);

    const { data: customerSegment } = await supabase
      .from('customer_segments')
      .select('*')
      .eq('company_id', companyId)
      .eq('customer_phone', customerPhone)
      .single();

    const { data: successfulConversions } = await supabase
      .from('payment_transactions')
      .select('*')
      .eq('company_id', companyId)
      .eq('payment_status', 'completed')
      .limit(10);

    const { data: clientInsights } = await supabase
      .from('client_information')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(50);

    // Build pattern analysis
    const patternAnalysis = {
      totalConversations: pastConversations?.length || 0,
      successfulConversions: successfulConversions?.length || 0,
      conversionRate: successfulConversions && pastConversations 
        ? (successfulConversions.length / pastConversations.length * 100).toFixed(1)
        : '0',
      customerSegment: customerSegment || null,
      recentInsights: clientInsights?.slice(0, 10) || [],
      commonPatterns: {
        avgResponseTime: pastConversations?.reduce((acc, conv) => {
          return acc + (conv.duration_seconds || 0);
        }, 0) / (pastConversations?.length || 1),
        commonObjections: clientInsights?.filter(i => i.info_type === 'objection').slice(0, 5) || [],
        successFactors: clientInsights?.filter(i => i.importance === 'high').slice(0, 5) || []
      }
    };

    // Perform web research if needed (using Lovable AI with web search capability)
    let researchInsights = null;
    if (lovableApiKey && (customerMessage.toLowerCase().includes('price') || 
        customerMessage.toLowerCase().includes('competitor') ||
        customerMessage.toLowerCase().includes('compare'))) {
      
      console.log('[Supervisor] Performing market research...');
      
      const researchPrompt = `Research context for ${companyData.name} (${companyData.business_type}):
Customer is asking: "${customerMessage}"
Provide brief market insights, pricing context, or competitive positioning that would help craft a strategic response.`;

      try {
        const researchResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${lovableApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [{ role: 'user', content: researchPrompt }],
            max_tokens: 500
          }),
        });

        if (researchResponse.ok) {
          const researchData = await researchResponse.json();
          researchInsights = researchData.choices[0]?.message?.content || null;
          console.log('[Supervisor] Research completed');
        }
      } catch (error) {
        console.error('[Supervisor] Research failed:', error);
      }
    }

    // Build supervisor prompt
    const supervisorPrompt = `You are the Strategic Supervisor for ${companyData.name}, an AI layer that ensures optimal customer interactions.

## YOUR ROLE
- Analyze conversations and patterns to recommend the BEST possible response
- You do NOT talk to customers - you guide the main assistant
- Focus on: conversion optimization, objection handling, brand consistency, persuasion

## COMPANY CONTEXT
Business: ${companyData.name} (${companyData.business_type})
Services: ${companyData.services || 'N/A'}
Payment Methods: ${companyData.payment_instructions || 'N/A'}
Brand Voice: ${companyData.voice_style || 'Professional and helpful'}

## CUSTOMER PROFILE
Phone: ${customerPhone}
${customerSegment ? `
Segment: ${customerSegment.segment_type}
Engagement Level: ${customerSegment.engagement_level}
Conversion Score: ${customerSegment.conversion_score}/100
Intent: ${customerSegment.intent_category}
Total Conversations: ${customerSegment.total_conversations}
` : 'New customer - no historical data'}

## PATTERN ANALYSIS
- Total company conversations analyzed: ${patternAnalysis.totalConversations}
- Successful conversions: ${patternAnalysis.successfulConversions}
- Conversion rate: ${patternAnalysis.conversionRate}%
- Common objections: ${patternAnalysis.commonPatterns.commonObjections.map(o => o.information).join('; ') || 'None identified'}
- Success factors: ${patternAnalysis.commonPatterns.successFactors.map(f => f.information).join('; ') || 'None identified'}

## RECENT CONVERSATION HISTORY
${conversationHistory.map((msg: any) => `${msg.role}: ${msg.content}`).join('\n')}

## CURRENT CUSTOMER MESSAGE
"${customerMessage}"

${researchInsights ? `## MARKET RESEARCH INSIGHTS
${researchInsights}
` : ''}

## YOUR TASK
Analyze this interaction and provide a strategic recommendation for the main assistant. Output a JSON object with:
{
  "analysis": "Brief analysis of the situation, customer intent, and key considerations",
  "strategy": "Recommended strategic approach (e.g., 'build trust first', 'address objection directly', 'create urgency', etc.)",
  "keyPoints": ["point 1", "point 2", "point 3"],
  "toneGuidance": "Recommended tone (e.g., 'warm and reassuring', 'professional and direct', etc.)",
  "recommendedResponse": "Suggested response content - the main assistant will use this as guidance to craft the final message",
  "conversionTips": ["tip 1", "tip 2"],
  "avoidances": ["what NOT to say or do"],
  "researchUsed": ${researchInsights ? 'true' : 'false'}
}

Be strategic, data-driven, and focus on maximizing conversion while maintaining brand integrity.`;

    // Call DeepSeek AI for supervisor analysis
    console.log('[Supervisor] Calling DeepSeek AI for strategic analysis...');
    
    const deepseekResponse = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${deepseekApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: 'You are a strategic supervisor AI. Analyze conversations and provide actionable recommendations in JSON format. Always respond with valid JSON only.' },
          { role: 'user', content: supervisorPrompt }
        ],
        temperature: 0.7,
        max_tokens: 4000
      }),
    });

    if (!deepseekResponse.ok) {
      const errorText = await deepseekResponse.text();
      console.error('[Supervisor] DeepSeek API error:', errorText);
      throw new Error('Supervisor analysis failed');
    }

    const deepseekData = await deepseekResponse.json();
    let responseContent = deepseekData.choices[0].message.content;
    
    // Strip markdown code blocks if present
    if (responseContent.includes('```')) {
      responseContent = responseContent
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
    }
    
    const recommendation = JSON.parse(responseContent);

    console.log('[Supervisor] Strategic recommendation generated');

    // Store supervisor recommendation for learning
    await supabase
      .from('boss_conversations')
      .insert({
        company_id: companyId,
        message_from: 'supervisor_agent',
        message_content: `Analysis for ${customerPhone}: ${customerMessage}`,
        response: JSON.stringify(recommendation)
      });

    return new Response(
      JSON.stringify({
        success: true,
        recommendation,
        metadata: {
          patternsAnalyzed: patternAnalysis.totalConversations,
          conversionRate: patternAnalysis.conversionRate,
          researchPerformed: !!researchInsights
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Supervisor] Error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error',
        fallback: true 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
