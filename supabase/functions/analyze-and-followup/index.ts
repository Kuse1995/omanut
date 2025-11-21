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
    const { companyId, time, stream } = body;

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

    // If streaming is requested, use SSE
    if (stream) {
      const encoder = new TextEncoder();
      const streamResponse = new ReadableStream({
        async start(controller) {
          const sendEvent = (data: any) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          };

          try {
            for (const currentCompanyId of companyIds) {
              await processCompany(currentCompanyId, supabase, supabaseUrl, supabaseKey, sendEvent);
            }
            
            sendEvent({ type: 'complete' });
            controller.close();
          } catch (error) {
            sendEvent({ type: 'error', message: error instanceof Error ? error.message : 'Unknown error' });
            controller.close();
          }
        }
      });

      return new Response(streamResponse, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        }
      });
    }

    // Non-streaming mode (for cron jobs)
    const allResults = [];

    for (const currentCompanyId of companyIds) {
      const results = await processCompany(currentCompanyId, supabase, supabaseUrl, supabaseKey);
      allResults.push(...results);
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: allResults.length,
        results: allResults
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function processCompany(
  currentCompanyId: string,
  supabase: any,
  supabaseUrl: string,
  supabaseKey: string,
  sendEvent?: (data: any) => void
) {
  const results: Array<{
    conversationId: string;
    customerPhone: string;
    followUpSent: boolean;
  }> = [];

  try {
    // Fetch company details
    const { data: company } = await supabase
      .from('companies')
      .select('*, company_ai_overrides(*)')
      .eq('id', currentCompanyId)
      .single();

    if (!company) {
      console.log(`Company ${currentCompanyId} not found, skipping`);
      return results;
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
      return results;
    }

    console.log(`Found ${conversations?.length || 0} conversations for ${company.name}`);

    if (!conversations || conversations.length === 0) {
      console.log(`No conversations for company ${company.name}`);
      if (sendEvent) {
        sendEvent({ 
          type: 'progress', 
          total: 0, 
          current: 0, 
          companyName: company.name 
        });
      }
      return results;
    }

    // Send initial progress
    const totalConversations = conversations.length;
    if (sendEvent) {
      sendEvent({ 
        type: 'start', 
        total: totalConversations, 
        companyName: company.name 
      });
    }

    for (let i = 0; i < conversations.length; i++) {
      const conv = conversations[i];
      
      try {
        // Fetch full message history
        const { data: messages } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: true });

        if (!messages || messages.length === 0) {
          console.log(`No messages in conversation ${conv.id}, skipping`);
          if (sendEvent) {
            sendEvent({ 
              type: 'progress', 
              total: totalConversations, 
              current: i + 1, 
              status: 'skipped',
              phone: conv.phone 
            });
          }
          continue;
        }

        // Build conversation history for supervisor
        const conversationHistory = messages.map((m: any) => ({
          role: m.role,
          content: m.content,
          created_at: m.created_at
        }));

        // Get the last customer message as the trigger
        const lastCustomerMessage = messages
          .filter((m: any) => m.role === 'user')
          .pop();

        if (!lastCustomerMessage) {
          console.log(`No customer messages in conversation ${conv.id}, skipping`);
          if (sendEvent) {
            sendEvent({ 
              type: 'progress', 
              total: totalConversations, 
              current: i + 1, 
              status: 'skipped',
              phone: conv.phone 
            });
          }
          continue;
        }

        console.log(`[Analyze] Processing conversation ${conv.id} for ${conv.phone}`);

        // Send progress update
        if (sendEvent) {
          sendEvent({ 
            type: 'progress', 
            total: totalConversations, 
            current: i + 1, 
            status: 'analyzing',
            phone: conv.phone 
          });
        }

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
          if (sendEvent) {
            sendEvent({ 
              type: 'progress', 
              total: totalConversations, 
              current: i + 1, 
              status: 'error',
              phone: conv.phone 
            });
          }
          continue;
        }

        const supervisorData = await supervisorResponse.json();
        
        if (!supervisorData.success) {
          console.error('Supervisor returned error:', supervisorData.error);
          if (sendEvent) {
            sendEvent({ 
              type: 'progress', 
              total: totalConversations, 
              current: i + 1, 
              status: 'error',
              phone: conv.phone 
            });
          }
          continue;
        }

        const recommendation = supervisorData.recommendation;
        
        // Get AI overrides for follow-up message
        const aiOverrides = company.company_ai_overrides?.[0];

        // Use Lovable AI Gateway with Gemini 3 Pro to craft follow-up message
        const geminiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('LOVABLE_API_KEY')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-pro',
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
${company.quick_reference_info ? `\n\n=== QUICK REFERENCE KNOWLEDGE BASE ===\n${company.quick_reference_info}` : ''}
${aiOverrides?.system_instructions ? `\n\n=== CUSTOM SYSTEM INSTRUCTIONS ===\n${aiOverrides.system_instructions}` : ''}
${aiOverrides?.qa_style ? `\n\n=== Q&A STYLE ===\n${aiOverrides.qa_style}` : ''}
${aiOverrides?.banned_topics ? `\n\n=== BANNED TOPICS ===\n${aiOverrides.banned_topics}` : ''}

Create a warm, personalized follow-up message (max 150 words) that:
1. References their previous interaction naturally
2. Provides value based on supervisor's guidance
3. Creates urgency without being pushy
4. Includes a clear call-to-action

Return ONLY the message text, no prefix or explanation.`
              }
            ],
            temperature: 1.0,
            max_tokens: 8192
          }),
        });

        if (!geminiResponse.ok) {
          console.error('Lovable AI failed:', await geminiResponse.text());
          if (sendEvent) {
            sendEvent({ 
              type: 'progress', 
              total: totalConversations, 
              current: i + 1, 
              status: 'error',
              phone: conv.phone 
            });
          }
          continue;
        }

        const geminiData = await geminiResponse.json();
        const followUpMessage = geminiData.choices[0]?.message?.content?.trim();

        if (!followUpMessage) {
          console.error('No follow-up message generated');
          if (sendEvent) {
            sendEvent({ 
              type: 'progress', 
              total: totalConversations, 
              current: i + 1, 
              status: 'error',
              phone: conv.phone 
            });
          }
          continue;
        }

        // Send the follow-up via WhatsApp
        const sendResponse = await supabase.functions.invoke('send-whatsapp-message', {
          body: {
            to: conv.phone,
            message: followUpMessage,
            companyId: company.id
          }
        });

        if (sendResponse.error) {
          console.error('Failed to send follow-up:', sendResponse.error);
          if (sendEvent) {
            sendEvent({ 
              type: 'progress', 
              total: totalConversations, 
              current: i + 1, 
              status: 'error',
              phone: conv.phone 
            });
          }
          continue;
        }

        results.push({
          conversationId: conv.id,
          customerPhone: conv.phone,
          followUpSent: true
        });

        // Send success progress update
        if (sendEvent) {
          sendEvent({ 
            type: 'progress', 
            total: totalConversations, 
            current: i + 1, 
            status: 'completed',
            phone: conv.phone 
          });
        }

        console.log(`[Analyze] Successfully sent follow-up to ${conv.phone}`);

      } catch (error) {
        console.error(`Error processing conversation ${conv.id}:`, error);
        if (sendEvent) {
          sendEvent({ 
            type: 'progress', 
            total: totalConversations, 
            current: i + 1, 
            status: 'error',
            phone: conv.phone 
          });
        }
      }
    }

  } catch (error) {
    console.error(`Error processing company ${currentCompanyId}:`, error);
  }

  return results;
}
