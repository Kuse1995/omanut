import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const { companyId, time } = body;

    // If no companyId provided (cron job), process all active companies
    let companyIds: string[] = [];
    
    if (companyId) {
      companyIds = [companyId];
    } else {
      // Get all companies with WhatsApp enabled
      const { data: companies } = await supabase
        .from('companies')
        .select('id')
        .not('whatsapp_number', 'is', null);
      
      companyIds = companies?.map(c => c.id) || [];
      console.log(`Cron job (${time || 'manual'}) processing ${companyIds.length} companies`);
    }

    const allResults = [];

    for (const currentCompanyId of companyIds) {
      try {

        // Fetch company details
        const { data: company } = await supabase
          .from('companies')
          .select('*')
          .eq('id', currentCompanyId)
          .single();

        if (!company) {
          console.log(`Company ${currentCompanyId} not found, skipping`);
          continue;
        }

        // Fetch active/recent conversations that need follow-up
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

        const { data: conversations } = await supabase
          .from('conversations')
          .select('*, messages(*)')
          .eq('company_id', currentCompanyId)
          .eq('status', 'active')
          .gte('started_at', threeDaysAgo.toISOString())
          .order('started_at', { ascending: false })
          .limit(10);

        if (!conversations || conversations.length === 0) {
          console.log(`No conversations for company ${company.name}`);
          continue;
        }

        const results = [];

        for (const conv of conversations) {
          try {
            // Get supervisor recommendation
            const supervisorResponse = await supabase.functions.invoke('supervisor-agent', {
          body: {
            companyId: company.id,
            customerPhone: conv.phone,
            customerName: conv.customer_name,
            message: 'Follow-up opportunity',
            conversationHistory: conv.messages || []
          }
            });

            if (supervisorResponse.error) {
              console.error('Supervisor error:', supervisorResponse.error);
              continue;
            }

            const recommendation = supervisorResponse.data;

            // Use Kimi AI to craft follow-up message based on supervisor's guidance
            const kimiResponse = await fetch('https://api.moonshot.ai/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${Deno.env.get('KIMI_API_KEY')}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'kimi-k2-thinking',
                messages: [
                  {
                    role: 'system',
                    content: `You are the Omanut Assistant for ${company.name}. Your supervisor has analyzed this customer conversation and provided strategic guidance. Craft a personalized follow-up WhatsApp message to re-engage the customer and drive conversion.

SUPERVISOR'S STRATEGIC ANALYSIS:
${recommendation.analysis}

RECOMMENDED STRATEGY:
${recommendation.strategy}

KEY POINTS TO ADDRESS:
${recommendation.keyPoints.join('\n')}

TONE GUIDANCE: ${recommendation.toneGuidance}

CONVERSION TIPS:
${recommendation.conversionTips.join('\n')}

AVOID:
${recommendation.avoidances.join('\n')}

COMPANY CONTEXT:
- Business: ${company.name} (${company.business_type})
- Services: ${company.services}
- Hours: ${company.hours}
- Currency: ${company.currency_prefix}

Create a warm, personalized follow-up message (max 150 words) that:
1. References their previous interaction naturally
2. Provides value or addresses their needs
3. Includes a clear call-to-action
4. Feels conversational, not sales-y
5. Incorporates supervisor's strategic guidance

IMPORTANT: Return ONLY the message text, no explanations or formatting.`
                  }
                ],
                temperature: 1.0,
                max_tokens: 500
              })
            });

            const kimiData = await kimiResponse.json();
            const followUpMessage = kimiData.choices[0].message.content;

            // Send follow-up via Twilio
            const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID');
            const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN');
            
            const twilioResponse = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`,
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                  From: `whatsapp:${company.whatsapp_number}`,
                  To: `whatsapp:${conv.phone}`,
                  Body: followUpMessage,
                }),
              }
            );

            if (!twilioResponse.ok) {
              console.error('Twilio error:', await twilioResponse.text());
              continue;
            }

            // Log the follow-up in messages
            await supabase.from('messages').insert({
              conversation_id: conv.id,
              role: 'assistant',
              content: followUpMessage,
              message_metadata: {
                type: 'supervisor_followup',
                supervisor_recommendation: recommendation,
                scheduled_time: time
              }
            });

            results.push({
              conversationId: conv.id,
              customerPhone: conv.phone,
              customerName: conv.customer_name,
              success: true,
              message: followUpMessage.substring(0, 100) + '...'
            });

          } catch (error) {
            console.error(`Error processing conversation ${conv.id}:`, error);
            results.push({
              conversationId: conv.id,
              customerPhone: conv.phone,
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }

        allResults.push({
          companyId: currentCompanyId,
          companyName: company.name,
          conversationsProcessed: results.length,
          results
        });

      } catch (companyError) {
        console.error(`Error processing company ${currentCompanyId}:`, companyError);
        allResults.push({
          companyId: currentCompanyId,
          error: companyError instanceof Error ? companyError.message : 'Unknown error'
        });
      }
    }

    const totalProcessed = allResults.reduce((sum, r) => sum + (r.conversationsProcessed || 0), 0);

    return new Response(JSON.stringify({ 
      success: true,
      companiesProcessed: companyIds.length,
      totalConversationsProcessed: totalProcessed,
      time: time || 'manual',
      companies: allResults 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in analyze-and-followup:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
