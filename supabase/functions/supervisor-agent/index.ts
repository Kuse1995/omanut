import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { geminiChat } from "../_shared/gemini-client.ts";

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

    const {
      companyId,
      customerPhone,
      customerMessage,
      conversationHistory,
      companyData,
      customerData,
      conversationId,
      realTimeAnalysis = false
    } = await req.json();

    console.log('[Supervisor] Analyzing interaction for:', customerPhone || conversationId, realTimeAnalysis ? '(real-time)' : '');

    // Fetch supervisor configuration
    const { data: aiConfig } = await supabase
      .from('company_ai_overrides')
      .select('*')
      .eq('company_id', companyId)
      .single();

    // Extract supervisor configuration with defaults
    const supervisorConfig = {
      analysisDepth: aiConfig?.supervisor_analysis_depth || 'balanced',
      focusAreas: aiConfig?.supervisor_focus_areas || ['conversion_optimization', 'customer_satisfaction'],
      recommendationStyle: aiConfig?.supervisor_recommendation_style || 'actionable',
      contextWindow: aiConfig?.supervisor_context_window || 10,
      researchEnabled: aiConfig?.supervisor_research_enabled ?? true,
      patternDetection: aiConfig?.supervisor_pattern_detection || ['buying_signals', 'objections', 'sentiment_shifts'],
      urgencyTriggers: aiConfig?.supervisor_urgency_triggers || {
        high_value_customer: true,
        complaint: true,
        churn_risk: true,
        escalation_needed: false,
        competitor_mention: false
      },
      outputFormat: aiConfig?.supervisor_output_format || 'structured_json'
    };

    console.log('[Supervisor] Using config:', {
      depth: supervisorConfig.analysisDepth,
      focusAreas: supervisorConfig.focusAreas.length,
      researchEnabled: supervisorConfig.researchEnabled
    });

    // ========== TIMESTAMP-BASED DATA FRESHNESS ==========
    // Only learn from conversations created AFTER the company's last configuration update
    // This prevents the supervisor from learning outdated patterns from before business rules changed
    const { data: companyDetails } = await supabase
      .from('companies')
      .select('updated_at')
      .eq('id', companyId)
      .single();
    
    const companyLastUpdated = companyDetails?.updated_at || '2000-01-01';
    console.log('[Supervisor] Company last updated:', companyLastUpdated, '- Only learning from conversations after this date');
    
    // Fetch pattern analysis data with configurable context window
    // CRITICAL: Only fetch conversations created AFTER the company was last updated
    // This ensures we don't learn from conversations that used outdated business rules
    const { data: pastConversations } = await supabase
      .from('conversations')
      .select(`
        *,
        messages(content, role, created_at)
      `)
      .eq('company_id', companyId)
      .gt('created_at', companyLastUpdated) // Only conversations after company update
      .order('created_at', { ascending: false })
      .limit(supervisorConfig.contextWindow * 2);
    
    console.log('[Supervisor] Filtered conversations (post-update only):', pastConversations?.length || 0);

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

    // Build pattern analysis based on configured patterns
    const patternAnalysis = {
      totalConversations: pastConversations?.length || 0,
      successfulConversions: successfulConversions?.length || 0,
      conversionRate: successfulConversions && pastConversations 
        ? (successfulConversions.length / pastConversations.length * 100).toFixed(1)
        : '0',
      customerSegment: customerSegment || null,
      recentInsights: clientInsights?.slice(0, 10) || [],
      detectedPatterns: {
        buyingSignals: supervisorConfig.patternDetection.includes('buying_signals'),
        objections: supervisorConfig.patternDetection.includes('objections'),
        sentimentShifts: supervisorConfig.patternDetection.includes('sentiment_shifts'),
        urgencyIndicators: supervisorConfig.patternDetection.includes('urgency_indicators'),
        loyaltySignals: supervisorConfig.patternDetection.includes('loyalty_signals'),
        churnRisk: supervisorConfig.patternDetection.includes('churn_risk'),
      },
      commonPatterns: {
        avgResponseTime: pastConversations?.reduce((acc, conv) => {
          return acc + (conv.duration_seconds || 0);
        }, 0) / (pastConversations?.length || 1),
        commonObjections: clientInsights?.filter(i => i.info_type === 'objection').slice(0, 5) || [],
        successFactors: clientInsights?.filter(i => i.importance === 'high').slice(0, 5) || []
      }
    };

    // Check urgency triggers
    const urgencyFlags: string[] = [];
    if (supervisorConfig.urgencyTriggers.high_value_customer && customerSegment?.conversion_score > 70) {
      urgencyFlags.push('HIGH_VALUE_CUSTOMER');
    }
    if (supervisorConfig.urgencyTriggers.complaint && 
        (customerMessage.toLowerCase().includes('complain') || 
         customerMessage.toLowerCase().includes('disappointed') ||
         customerMessage.toLowerCase().includes('unhappy'))) {
      urgencyFlags.push('COMPLAINT_DETECTED');
    }
    if (supervisorConfig.urgencyTriggers.churn_risk && customerSegment?.engagement_level === 'low') {
      urgencyFlags.push('CHURN_RISK');
    }
    if (supervisorConfig.urgencyTriggers.competitor_mention &&
        customerMessage.toLowerCase().includes('competitor')) {
      urgencyFlags.push('COMPETITOR_MENTION');
    }

    // Perform web research if enabled and needed
    let researchInsights = null;
    if (supervisorConfig.researchEnabled && 
        (customerMessage.toLowerCase().includes('price') || 
         customerMessage.toLowerCase().includes('competitor') ||
         customerMessage.toLowerCase().includes('compare'))) {
      
      console.log('[Supervisor] Performing market research...');
      
      const researchPrompt = `Research context for ${companyData.name} (${companyData.business_type}):
Customer is asking: "${customerMessage}"
Provide brief market insights, pricing context, or competitive positioning that would help craft a strategic response.`;

      try {
        const researchResponse = await geminiChat({
          model: 'glm-4.7',
          messages: [{ role: 'user', content: researchPrompt }],
          max_tokens: 500
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

    // Build analysis depth instructions
    const depthInstructions = {
      quick: 'Provide a brief, surface-level analysis. Focus only on the most critical points.',
      balanced: 'Provide a balanced analysis with key insights and actionable recommendations.',
      deep: 'Provide a comprehensive analysis covering all aspects of the interaction.',
      exhaustive: 'Provide an exhaustive analysis with maximum detail, including subtle nuances and secondary considerations.'
    };

    // Build recommendation style instructions
    const styleInstructions = {
      actionable: 'Focus on specific, actionable steps the agent should take immediately.',
      strategic: 'Provide high-level strategic insights and positioning guidance.',
      coaching: 'Offer educational guidance to help improve future interactions.',
      data_driven: 'Emphasize metrics, numbers, and quantifiable insights.'
    };

    // Build focus areas section
    const focusAreaDescriptions: Record<string, string> = {
      conversion_optimization: 'maximizing the chance of converting this interaction into a sale',
      customer_satisfaction: 'ensuring the customer feels heard, valued, and satisfied',
      upselling: 'identifying opportunities to offer additional products or services',
      issue_resolution: 'resolving any problems or concerns quickly and effectively',
      sentiment_analysis: 'understanding and responding to the customer\'s emotional state',
      competitor_intelligence: 'gathering and leveraging competitive information'
    };

    const focusAreasText = supervisorConfig.focusAreas
      .map((area: string) => focusAreaDescriptions[area] || area)
      .join(', ');

    // Build supervisor prompt with configuration
    const supervisorPrompt = `You are the Strategic Supervisor for ${companyData.name}, an AI layer that ensures optimal customer interactions.

## YOUR ROLE
- Analyze conversations and patterns to recommend the BEST possible response
- You do NOT talk to customers - you guide the main assistant
- Analysis Depth: ${depthInstructions[supervisorConfig.analysisDepth as keyof typeof depthInstructions] || depthInstructions.balanced}
- Recommendation Style: ${styleInstructions[supervisorConfig.recommendationStyle as keyof typeof styleInstructions] || styleInstructions.actionable}
- Primary Focus Areas: ${focusAreasText}

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
- Patterns to detect: ${supervisorConfig.patternDetection.join(', ')}
- Common objections: ${patternAnalysis.commonPatterns.commonObjections.map(o => o.information).join('; ') || 'None identified'}
- Success factors: ${patternAnalysis.commonPatterns.successFactors.map(f => f.information).join('; ') || 'None identified'}

${urgencyFlags.length > 0 ? `## ⚠️ URGENCY FLAGS DETECTED
${urgencyFlags.join(', ')}
Prioritize addressing these concerns in your recommendations.
` : ''}

## RECENT CONVERSATION HISTORY (last ${supervisorConfig.contextWindow} messages)
${conversationHistory.slice(-supervisorConfig.contextWindow).map((msg: any) => `${msg.role}: ${msg.content}`).join('\n')}

## CURRENT CUSTOMER MESSAGE
"${customerMessage}"

${researchInsights ? `## MARKET RESEARCH INSIGHTS
${researchInsights}
` : ''}

## YOUR TASK
Analyze this interaction and provide a strategic recommendation for the main assistant. 
${supervisorConfig.outputFormat === 'structured_json' ? `Output a JSON object with:
{
  "analysis": "Brief analysis of the situation, customer intent, and key considerations",
  "strategy": "Recommended strategic approach",
  "keyPoints": ["point 1", "point 2", "point 3"],
  "toneGuidance": "Recommended tone",
  "recommendedResponse": "Suggested response content",
  "conversionTips": ["tip 1", "tip 2"],
  "avoidances": ["what NOT to say or do"],
  "urgencyLevel": "low|medium|high|critical",
  "detectedPatterns": ["pattern1", "pattern2"],
  "researchUsed": ${researchInsights ? 'true' : 'false'}
}` : supervisorConfig.outputFormat === 'narrative' ? 
'Provide a narrative response with clear sections for Analysis, Strategy, Recommendations, and Warnings.' :
supervisorConfig.outputFormat === 'bullet_points' ?
'Provide your analysis as concise bullet points organized by: Key Insights, Recommended Actions, Things to Avoid.' :
'Provide a hybrid response with a brief JSON summary followed by a narrative explanation.'}

Be strategic, data-driven, and focus on ${focusAreasText}.`;

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
          { 
            role: 'system', 
            content: `You are a strategic supervisor AI. Analyze conversations and provide ${supervisorConfig.recommendationStyle} recommendations. ${supervisorConfig.outputFormat === 'structured_json' ? 'Always respond with valid JSON only.' : 'Respond in the requested format.'}` 
          },
          { role: 'user', content: supervisorPrompt }
        ],
        temperature: supervisorConfig.analysisDepth === 'exhaustive' ? 0.8 : 0.7,
        max_tokens: supervisorConfig.analysisDepth === 'quick' ? 1500 : 
                   supervisorConfig.analysisDepth === 'exhaustive' ? 6000 : 4000
      }),
    });

    if (!deepseekResponse.ok) {
      const errorText = await deepseekResponse.text();
      console.error('[Supervisor] DeepSeek API error:', errorText);
      throw new Error('Supervisor analysis failed');
    }

    const deepseekData = await deepseekResponse.json();
    let responseContent = deepseekData.choices[0].message.content;
    
    let recommendation;
    if (supervisorConfig.outputFormat === 'structured_json') {
      // Strip markdown code blocks if present
      if (responseContent.includes('```')) {
        responseContent = responseContent
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .trim();
      }
      recommendation = JSON.parse(responseContent);
    } else {
      recommendation = { content: responseContent, format: supervisorConfig.outputFormat };
    }

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
          researchPerformed: !!researchInsights,
          analysisDepth: supervisorConfig.analysisDepth,
          focusAreas: supervisorConfig.focusAreas,
          urgencyFlags
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Supervisor] Error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'An error occurred processing your request',
        fallback: true 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
