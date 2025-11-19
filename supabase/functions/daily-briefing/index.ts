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
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY')!;
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')!;
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { triggerType = 'scheduled_morning', conversationId = null, companyId = null } = await req.json();

    console.log('Daily briefing triggered:', { triggerType, conversationId, companyId });

    // Determine which companies to analyze
    let companies = [];
    if (companyId) {
      const { data: company } = await supabase
        .from('companies')
        .select('*')
        .eq('id', companyId)
        .single();
      if (company) companies = [company];
    } else {
      const { data: allCompanies } = await supabase
        .from('companies')
        .select('*')
        .not('boss_phone', 'is', null);
      companies = allCompanies || [];
    }

    console.log(`Analyzing ${companies.length} companies`);

    for (const company of companies) {
      try {
        console.log(`Processing briefing for company: ${company.name}`);

        // Fetch last 24 hours of data
        const yesterday = new Date();
        yesterday.setHours(yesterday.getHours() - 24);

        // 1. Get conversations from last 24 hours
        const { data: conversations } = await supabase
          .from('conversations')
          .select('id, customer_name, phone, status, started_at, ended_at, quality_flag, active_agent, human_takeover, is_paused_for_human')
          .eq('company_id', company.id)
          .gte('started_at', yesterday.toISOString())
          .order('started_at', { ascending: false });

        if (!conversations || conversations.length === 0) {
          console.log(`No conversations in last 24h for ${company.name}, skipping briefing`);
          continue;
        }

        // 2. Get full message history for each conversation
        const conversationsWithMessages = await Promise.all(
          conversations.map(async (conv) => {
            const { data: messages } = await supabase
              .from('messages')
              .select('role, content, created_at')
              .eq('conversation_id', conv.id)
              .order('created_at', { ascending: true });
            
            return { ...conv, messages: messages || [] };
          })
        );

        // 3. Get agent performance data
        const { data: agentPerformance } = await supabase
          .from('agent_performance')
          .select('*')
          .eq('company_id', company.id)
          .gte('routed_at', yesterday.toISOString());

        // 4. Get completed sales
        const { data: sales } = await supabase
          .from('payment_transactions')
          .select('amount, payment_status, customer_name, created_at')
          .eq('company_id', company.id)
          .gte('created_at', yesterday.toISOString())
          .eq('payment_status', 'completed');

        // 5. Get new reservations
        const { data: reservations } = await supabase
          .from('reservations')
          .select('name, guests, date, time, created_at')
          .eq('company_id', company.id)
          .gte('created_at', yesterday.toISOString());

        // 6. Get action items
        const { data: actionItems } = await supabase
          .from('action_items')
          .select('action_type, description, status, completed_at')
          .eq('company_id', company.id)
          .gte('created_at', yesterday.toISOString());

        // 7. Get critical client insights
        const { data: clientInsights } = await supabase
          .from('client_information')
          .select('customer_name, info_type, information, importance')
          .eq('company_id', company.id)
          .gte('created_at', yesterday.toISOString())
          .eq('importance', 'high');

        // Prepare data for analysis
        const analysisData = {
          conversations: conversationsWithMessages,
          agentPerformance: agentPerformance || [],
          sales: sales || [],
          reservations: reservations || [],
          actionItems: actionItems || [],
          clientInsights: clientInsights || []
        };

        // Build DeepSeek analyst prompt
        const ANALYST_SYSTEM_PROMPT = `You are a Business Intelligence Analyst reviewing AI assistant performance for ${company.name}.

ANALYSIS OBJECTIVES:
1. Identify AI mistakes, broken promises, or incorrect information given to customers
2. Detect knowledge gaps (questions AI couldn't answer confidently)
3. Analyze sales performance and conversion patterns
4. Spot customer behavior patterns and actionable insights
5. Evaluate agent performance (Support vs Sales)
6. Flag critical issues requiring immediate human attention

CRITICAL FLAGS (require immediate boss notification):
- AI promised something not feasible (delivery time, pricing, etc.)
- AI gave wrong information contradicting company policy
- Customer extremely upset and AI failed to escalate
- Payment agreement made but not properly handed off
- Safety/legal concerns mentioned

RESPONSE FORMAT:
Return JSON with this exact structure:
{
  "hasCriticalIssues": boolean,
  "criticalIssues": [
    {
      "client": "Customer name",
      "phone": "Customer phone",
      "issue": "Brief description of mistake/problem",
      "action": "What boss should do to fix it"
    }
  ],
  "qualityIssues": [
    "List of non-critical quality problems (wrong tone, missed opportunities, etc.)"
  ],
  "insights": [
    {
      "pattern": "What pattern was detected",
      "recommendation": "Actionable recommendation"
    }
  ],
  "agentPerformance": {
    "supportAgent": {
      "conversationsHandled": number,
      "resolutionRate": "X%",
      "escalationRate": "Y%",
      "notes": "Brief assessment"
    },
    "salesAgent": {
      "conversationsHandled": number,
      "conversionRate": "X%",
      "totalRevenue": "$X",
      "notes": "Brief assessment"
    }
  },
  "overview": {
    "totalConversations": number,
    "salesClosed": number,
    "totalRevenue": "$X",
    "reservationsMade": number,
    "activeActionItems": number
  }
}

Be specific with client names and phone numbers when flagging issues. Focus on actionable insights.`;

        console.log('Calling DeepSeek for analysis...');

        // Call DeepSeek for analysis
        const deepseekResponse = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
              { role: 'system', content: ANALYST_SYSTEM_PROMPT },
              { 
                role: 'user', 
                content: `Analyze the following business data from the last 24 hours:\n\n${JSON.stringify(analysisData, null, 2)}`
              }
            ],
            temperature: 0.3,
            max_tokens: 2000,
            response_format: { type: "json_object" }
          })
        });

        if (!deepseekResponse.ok) {
          const errorText = await deepseekResponse.text();
          console.error('DeepSeek API error:', errorText);
          throw new Error(`DeepSeek API failed: ${deepseekResponse.status}`);
        }

        const deepseekData = await deepseekResponse.json();
        const analysisText = deepseekData.choices[0].message.content;
        const analysis = JSON.parse(analysisText);

        console.log('Analysis completed:', analysis);

        // Format briefing message based on trigger type
        let briefingMessage = '';

        if (triggerType === 'handoff' && conversationId) {
          // Post-handoff mini-briefing
          briefingMessage = `📋 Handoff Context\n\n`;
          
          if (analysis.qualityIssues.length > 0) {
            briefingMessage += `Quality Notes:\n${analysis.qualityIssues.slice(0, 2).map((issue: string) => `• ${issue}`).join('\n')}\n\n`;
          }
          
          if (analysis.insights.length > 0) {
            briefingMessage += `Customer Intent: ${analysis.insights[0].pattern || 'Unknown'}`;
          }
        } else {
          // Full daily briefing or critical alert
          briefingMessage = `🕵️ Supervisor Daily Briefing\n\n`;
          
          // Overview
          const overview = analysis.overview;
          briefingMessage += `📊 Overview: ${overview.totalConversations} Conversations`;
          if (overview.salesClosed > 0) {
            briefingMessage += `, ${overview.salesClosed} Sales Closed (${overview.totalRevenue})`;
          }
          if (overview.reservationsMade > 0) {
            briefingMessage += `, ${overview.reservationsMade} Reservations`;
          }
          briefingMessage += `\n\n`;

          // Critical issues
          if (analysis.hasCriticalIssues && analysis.criticalIssues.length > 0) {
            briefingMessage += `⚠️ CRITICAL ATTENTION NEEDED:\n\n`;
            analysis.criticalIssues.forEach((issue: any) => {
              briefingMessage += `• Client: ${issue.client} (${issue.phone})\n`;
              briefingMessage += `  Issue: ${issue.issue}\n`;
              briefingMessage += `  Action: ${issue.action}\n\n`;
            });
          }

          // Quality issues
          if (analysis.qualityIssues.length > 0) {
            briefingMessage += `🔍 Quality Issues:\n`;
            analysis.qualityIssues.slice(0, 3).forEach((issue: string) => {
              briefingMessage += `• ${issue}\n`;
            });
            briefingMessage += `\n`;
          }

          // Insights & Recommendations
          if (analysis.insights.length > 0) {
            briefingMessage += `💡 Insights & Recommendations:\n\n`;
            analysis.insights.forEach((insight: any) => {
              briefingMessage += `• Pattern: ${insight.pattern}\n`;
              briefingMessage += `  → Recommendation: ${insight.recommendation}\n\n`;
            });
          }

          // Agent Performance
          briefingMessage += `📈 Agent Performance:\n\n`;
          
          const supportAgent = analysis.agentPerformance.supportAgent;
          briefingMessage += `Support Agent:\n`;
          briefingMessage += `• ${supportAgent.conversationsHandled} conversations handled\n`;
          briefingMessage += `• ${supportAgent.resolutionRate} resolution rate\n`;
          briefingMessage += `• ${supportAgent.escalationRate} escalation rate\n`;
          briefingMessage += `• Note: ${supportAgent.notes}\n\n`;

          const salesAgent = analysis.agentPerformance.salesAgent;
          briefingMessage += `Sales Agent:\n`;
          briefingMessage += `• ${salesAgent.conversationsHandled} conversations handled\n`;
          briefingMessage += `• ${salesAgent.conversionRate} conversion rate\n`;
          briefingMessage += `• ${salesAgent.totalRevenue} total revenue\n`;
          briefingMessage += `• Note: ${salesAgent.notes}\n\n`;

          // Completed items
          const completedItems = actionItems?.filter((item: any) => item.status === 'completed').length || 0;
          if (completedItems > 0 || overview.reservationsMade > 0) {
            briefingMessage += `✅ Completed Today:\n`;
            if (completedItems > 0) {
              briefingMessage += `• ${completedItems} action items resolved\n`;
            }
            if (overview.reservationsMade > 0) {
              briefingMessage += `• ${overview.reservationsMade} reservations confirmed\n`;
            }
          }
        }

        console.log('Formatted briefing message:', briefingMessage);

        // Send WhatsApp message to boss
        if (company.boss_phone && company.whatsapp_number) {
          const twilioResponse = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
            {
              method: 'POST',
              headers: {
                'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                From: `whatsapp:${company.whatsapp_number}`,
                To: `whatsapp:${company.boss_phone}`,
                Body: briefingMessage,
              }),
            }
          );

          if (!twilioResponse.ok) {
            const errorText = await twilioResponse.text();
            console.error('Twilio error:', errorText);
            throw new Error(`Failed to send WhatsApp: ${twilioResponse.status}`);
          }

          console.log('WhatsApp briefing sent successfully');
        }

        // Log briefing to boss_conversations
        await supabase
          .from('boss_conversations')
          .insert({
            company_id: company.id,
            message_from: triggerType === 'handoff' ? 'handoff_briefing_system' : 'daily_briefing_system',
            message_content: briefingMessage,
            response: JSON.stringify(analysis),
            handed_off_by: 'supervisor_analyst'
          });

        console.log(`Briefing completed for ${company.name}`);

      } catch (companyError) {
        console.error(`Error processing briefing for company ${company.name}:`, companyError);
        // Continue to next company even if one fails
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Daily briefing processed for ${companies.length} companies`,
        triggerType 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Daily briefing error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        details: error
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
