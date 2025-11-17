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
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        console.log(`Fetching conversations for company ${currentCompanyId} since ${sevenDaysAgo.toISOString()}`);

        const { data: conversations, error: convError } = await supabase
          .from('conversations')
          .select('*')
          .eq('company_id', currentCompanyId)
          .eq('status', 'active')
          .gte('started_at', sevenDaysAgo.toISOString())
          .order('started_at', { ascending: false })
          .limit(10);

        if (convError) {
          console.error(`Error fetching conversations for ${company.name}:`, convError);
          continue;
        }

        console.log(`Found ${conversations?.length || 0} conversations for ${company.name}`);

        if (!conversations || conversations.length === 0) {
          console.log(`No conversations for company ${company.name}`);
          continue;
        }

        const results = [];

        for (const conv of conversations) {
          try {
            // Fetch full message history
            const { data: messages } = await supabase
              .from('messages')
              .select('*')
              .eq('conversation_id', conv.id)
              .order('created_at', { ascending: true });

            if (!messages || messages.length === 0) {
              console.log(`No messages in conversation ${conv.id}, skipping`);
              continue;
            }

            // Build conversation history for supervisor
            const conversationHistory = messages.map(m => ({
              role: m.role,
              content: m.content,
              created_at: m.created_at
            }));

            // Get the last customer message as the trigger
            const lastCustomerMessage = messages
              .filter(m => m.role === 'user')
              .pop();

            if (!lastCustomerMessage) {
              console.log(`No customer messages in conversation ${conv.id}, skipping`);
              continue;
            }

            console.log(`[Analyze] Processing conversation ${conv.id} for ${conv.phone}`);

            // Get supervisor recommendation
            const supervisorResponse = await fetch(
              `${supabaseUrl}/functions/v1/supervisor-agent`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${supabaseKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  companyId: company.id,
                  customerPhone: conv.phone,
                  customerMessage: lastCustomerMessage.content,
                  conversationHistory: conversationHistory,
                  companyData: company,
                  customerData: conv
                })
              }
            );

            if (!supervisorResponse.ok) {
              const errorText = await supervisorResponse.text();
              console.error('Supervisor error:', errorText);
              continue;
            }

            const supervisorData = await supervisorResponse.json();
            
            if (!supervisorData.success) {
              console.error('Supervisor returned error:', supervisorData.error);
              continue;
            }

            const recommendation = supervisorData.recommendation;

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
