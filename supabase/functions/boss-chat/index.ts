import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { From, Body, ProfileName } = await req.json();

    console.log('Management message received:', { From, Body, ProfileName });

    // Normalize phone numbers for comparison
    const normalizePhone = (phone: string) => {
      return phone.replace(/^whatsapp:/i, '').replace(/\+/g, '').replace(/\s/g, '');
    };
    
    const normalizedFrom = normalizePhone(From || '');

    // Find company by management phone
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('*, company_ai_overrides(*), company_documents(*)')
      .ilike('boss_phone', `%${normalizedFrom}%`)
      .single();

    if (companyError || !company) {
      console.error('Management phone not found:', From);
      return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        headers: { ...corsHeaders, 'Content-Type': 'text/xml' }
      });
    }

    console.log('Management company found:', company.name);

    // Get recent conversation stats with messages
    const { data: recentConvs } = await supabase
      .from('conversations')
      .select('id, customer_name, phone, started_at, ended_at, status, quality_flag, transcript')
      .eq('company_id', company.id)
      .order('started_at', { ascending: false })
      .limit(10);

    // Get messages for each conversation to build detailed summaries
    const conversationsWithMessages = await Promise.all(
      (recentConvs || []).map(async (conv) => {
        const { data: messages } = await supabase
          .from('messages')
          .select('role, content, created_at')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: true })
          .limit(20);
        
        return {
          ...conv,
          messages: messages || []
        };
      })
    );

    // Get recent reservations
    const { data: recentReservations } = await supabase
      .from('reservations')
      .select('*')
      .eq('company_id', company.id)
      .order('created_at', { ascending: false })
      .limit(10);

    // Specifically get demo bookings
    const { data: demoBookings } = await supabase
      .from('reservations')
      .select('*')
      .eq('company_id', company.id)
      .ilike('occasion', '%demo%')
      .order('created_at', { ascending: false })
      .limit(10);

    console.log('Demo bookings found:', demoBookings?.length || 0, demoBookings);

    // Get action items
    const { data: actionItems } = await supabase
      .from('action_items')
      .select('*')
      .eq('company_id', company.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(5);

    // Get client insights
    const { data: clientInfo } = await supabase
      .from('client_information')
      .select('*')
      .eq('company_id', company.id)
      .order('created_at', { ascending: false })
      .limit(10);

    // Get total statistics for comprehensive sales data
    const { count: totalConversations } = await supabase
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', company.id);

    const { count: totalReservations } = await supabase
      .from('reservations')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', company.id);

    // Get unique customer count
    const { data: uniqueCustomers } = await supabase
      .from('conversations')
      .select('phone')
      .eq('company_id', company.id)
      .not('phone', 'is', null);

    const uniquePhones = new Set(uniqueCustomers?.map(c => c.phone) || []);

    // Get payment transactions for revenue data
    const { data: paymentData } = await supabase
      .from('payment_transactions')
      .select('amount, payment_status, customer_phone, customer_name, created_at')
      .eq('company_id', company.id)
      .order('created_at', { ascending: false })
      .limit(20);

    const totalRevenue = paymentData?.reduce((sum, p) => 
      p.payment_status === 'completed' ? sum + Number(p.amount) : sum, 0) || 0;

    const pendingRevenue = paymentData?.reduce((sum, p) => 
      p.payment_status === 'pending' ? sum + Number(p.amount) : sum, 0) || 0;

    // Get customer segments
    const { data: segments } = await supabase
      .from('customer_segments')
      .select('*')
      .eq('company_id', company.id)
      .order('conversion_score', { ascending: false })
      .limit(20);

    // Build context for AI
    const knowledgeBase = company.company_documents
      ?.map((doc: any) => doc.parsed_content)
      .filter(Boolean)
      .join('\n\n') || '';

    const aiOverrides = company.company_ai_overrides?.[0];

    // Format data concisely for AI with actual conversation content
    const conversationsSummary = conversationsWithMessages?.length 
      ? `RECENT CONVERSATIONS (showing ${conversationsWithMessages.length} of ${totalConversations || 0} total):\n\n${conversationsWithMessages.map((c: any) => {
          const messagePreview = c.messages.length > 0 
            ? c.messages.slice(0, 10).map((m: any) => `${m.role === 'user' ? 'Customer' : 'AI'}: ${m.content.substring(0, 200)}`).join('\n    ')
            : 'No messages';
          
          const transcript = c.transcript || 'No transcript available';
          
          return `\n📞 ${c.customer_name || 'Unknown'} (${c.phone || 'N/A'})
  Status: ${c.status}${c.quality_flag ? ` | Quality: ${c.quality_flag}` : ''}
  Started: ${new Date(c.started_at).toLocaleString()}
  
  Conversation Preview:
    ${messagePreview}
  
  ${c.transcript ? `Full Transcript Summary:\n    ${transcript.substring(0, 500)}${transcript.length > 500 ? '...' : ''}` : ''}`;
        }).join('\n\n---\n')}`
      : 'No recent conversations';

    const demoBookingsSummary = demoBookings?.length
      ? `${demoBookings.length} demo bookings:\n${demoBookings.map((r: any) =>
          `• ${r.name} - ${r.date} at ${r.time} (${r.status})`
        ).join('\n')}`
      : 'No demo bookings';

    const reservationsSummary = recentReservations?.length
      ? `${recentReservations.length} recent reservations:\n${recentReservations.map((r: any) =>
          `• ${r.name} - ${r.guests} guests on ${r.date} at ${r.time} (${r.status})`
        ).join('\n')}`
      : 'No recent reservations';

    const actionItemsSummary = actionItems?.length
      ? `${actionItems.length} pending actions:\n${actionItems.map((a: any) =>
          `• [${a.priority}] ${a.action_type}: ${a.description}`
        ).join('\n')}`
      : 'No pending actions';

    const clientInsightsSummary = clientInfo?.length
      ? `${clientInfo.length} client insights:\n${clientInfo.map((i: any) =>
          `• ${i.customer_name || 'Unknown'}: ${i.information}`
        ).join('\n')}`
      : 'No client insights';

    const paymentSummary = paymentData?.length
      ? `RECENT PAYMENTS (last ${Math.min(paymentData.length, 10)}):\n${paymentData.slice(0, 10).map((p: any) =>
          `• ${p.customer_name || 'Unknown'} (${p.customer_phone || 'N/A'}): ${company.currency_prefix}${Number(p.amount).toFixed(2)} - ${p.payment_status}`
        ).join('\n')}`
      : 'No payment transactions';

    const segmentsSummary = segments?.length
      ? `CUSTOMER SEGMENTS (top 20 by conversion score):\n${segments.map((s: any) => {
          const badges = [];
          if (s.has_payment) badges.push(`${company.currency_prefix}${s.total_spend}`);
          if (s.has_reservation) badges.push('Reserved');
          return `• ${s.customer_name || 'Unknown'} (${s.customer_phone}): ${s.segment_type.replace(/_/g, ' ').toUpperCase()} | Engagement: ${s.engagement_level} (${s.engagement_score}%) | Intent: ${s.intent_category} (${s.intent_score}%) | Conversion: ${s.conversion_potential} (${s.conversion_score}%)${badges.length ? ` [${badges.join(', ')}]` : ''}`;
        }).join('\n')}`
      : 'No customer segments analyzed yet';

    const systemPrompt = `You are the Head of Sales & Marketing AI advisor for ${company.name}, a ${company.business_type}.

Your role is to analyze customer interactions, identify sales opportunities, and provide strategic marketing recommendations to drive revenue growth.

BUSINESS INFO:
Type: ${company.business_type}
Hours: ${company.hours}
Services/Menu: ${company.services}
${aiOverrides?.system_instructions ? `\nSpecial Context: ${aiOverrides.system_instructions}` : ''}

BUSINESS STATISTICS:
📊 Total Conversations: ${totalConversations || 0}
👥 Unique Customers: ${uniquePhones.size}
💰 Total Revenue: ${company.currency_prefix}${totalRevenue.toFixed(2)}
⏳ Pending Revenue: ${company.currency_prefix}${pendingRevenue.toFixed(2)}
📅 Total Reservations: ${totalReservations || 0}
🔄 Conversion Rate: ${(totalConversations || 0) > 0 ? ((totalReservations || 0) / (totalConversations || 0) * 100).toFixed(1) : 0}%

CURRENT OPERATIONAL DATA:
${conversationsSummary}

${demoBookingsSummary}

${reservationsSummary}

${actionItemsSummary}

${clientInsightsSummary}

${paymentSummary}

${segmentsSummary}

${knowledgeBase ? `\nKNOWLEDGE BASE:\n${knowledgeBase}` : ''}

YOUR CAPABILITIES AS HEAD OF SALES & MARKETING:

**DATA ACCESS**: You have FULL access to:
- All ${totalConversations || 0} conversations with customer names and phone numbers
- Complete payment history (${company.currency_prefix}${totalRevenue.toFixed(2)} total revenue)
- All ${totalReservations || 0} reservations
- Customer segmentation data with engagement, intent, and conversion metrics
- Action items and client insights
- Business configuration and settings

1. **Sales Analysis**: Calculate conversion rates (currently ${(totalConversations || 0) > 0 ? ((totalReservations || 0) / (totalConversations || 0) * 100).toFixed(1) : 0}%), identify hot leads from the ${uniquePhones.size} unique customers, spot sales patterns, and revenue opportunities.

2. **Marketing Strategy**: Recommend campaigns, pricing adjustments, promotional offers, and customer engagement tactics based on actual customer behavior.

3. **Customer Intelligence**: Analyze customer preferences, common objections, pain points, and buying triggers from conversations.

4. **Revenue Optimization**: Suggest upselling opportunities, product bundling, peak-time pricing, and menu/service optimization.

5. **Competitive Positioning**: Advise on market positioning, unique selling points, and differentiation strategies.

6. **Growth Planning**: Create actionable marketing plans, customer acquisition strategies, and retention programs.

RESPONSE GUIDELINES:
- When asked general questions, provide operational updates with sales/marketing insights
- When asked "how to increase sales" or similar, analyze the data and provide specific, actionable recommendations
- Always base advice on actual conversation data, customer patterns, and business metrics
- Be direct and strategic - you're advising the owner/management
- Quantify opportunities when possible (e.g., "3 customers asked about X - potential revenue opportunity")
- Prioritize high-impact, low-effort wins alongside long-term strategies

FORMATTING RULES (CRITICAL):
- DO NOT use markdown formatting (no **, *, #, etc.)
- Use plain text only with clear line breaks for structure
- Use emojis sparingly for visual organization
- Format lists with dashes or numbers
- Keep responses clean and organized
- Use proper spacing between sections

Focus on driving revenue growth through data-driven sales and marketing strategies.`;

    // Define management tools for updating company settings
    const managementTools = [
      {
        type: "function",
        function: {
          name: "update_business_hours",
          description: "Update the company's business operating hours",
          parameters: {
            type: "object",
            properties: {
              hours: { type: "string", description: "New business hours (e.g., 'Mon-Sun: 9:00 AM - 11:00 PM')" }
            },
            required: ["hours"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_services",
          description: "Update the menu/services list including pricing",
          parameters: {
            type: "object",
            properties: {
              services: { type: "string", description: "Updated services/menu with prices" }
            },
            required: ["services"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_service_locations",
          description: "Update service areas or seating locations",
          parameters: {
            type: "object",
            properties: {
              locations: { type: "string", description: "Comma-separated list of locations" }
            },
            required: ["locations"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_branches",
          description: "Update branch information",
          parameters: {
            type: "object",
            properties: {
              branches: { type: "string", description: "Branch names or locations" }
            },
            required: ["branches"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_payment_info",
          description: "Update payment numbers and instructions",
          parameters: {
            type: "object",
            properties: {
              mtn_number: { type: "string", description: "MTN mobile money number" },
              airtel_number: { type: "string", description: "Airtel money number" },
              zamtel_number: { type: "string", description: "Zamtel money number" },
              payment_instructions: { type: "string", description: "Payment instructions for customers" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_voice_style",
          description: "Update the AI voice personality and style",
          parameters: {
            type: "object",
            properties: {
              voice_style: { type: "string", description: "Description of desired voice/personality" }
            },
            required: ["voice_style"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_ai_instructions",
          description: "Update system instructions for customer AI behavior",
          parameters: {
            type: "object",
            properties: {
              system_instructions: { type: "string", description: "Special instructions for AI" },
              qa_style: { type: "string", description: "Question-answer style guidance" },
              banned_topics: { type: "string", description: "Topics the AI should avoid" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_quick_reference",
          description: "Update quick reference information for AI",
          parameters: {
            type: "object",
            properties: {
              quick_reference_info: { type: "string", description: "Quick reference info for AI to use" }
            },
            required: ["quick_reference_info"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_all_customers",
          description: "Get complete list of all customers with phone numbers and conversation history",
          parameters: {
            type: "object",
            properties: {},
            required: []
          }
        }
      }
    ];

    // Call Lovable AI Gateway with Gemini 3 Pro
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
    console.log('Boss chat request:', { companyName: company.name, question: Body });
    
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: Body }
        ],
        temperature: 1.0,
        max_tokens: 8192,
        tools: managementTools
      }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error('Lovable AI API error:', data);
      throw new Error(`Lovable AI error: ${data.error?.message || 'Unknown error'}`);
    }
    
    if (!data.choices?.[0]?.message) {
      console.error('No message in AI response:', data);
      throw new Error('Invalid AI response format');
    }
    
    const aiMessage = data.choices[0].message;
    let aiResponse = aiMessage.content || '';

    // Handle tool calls if present
    if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
      console.log('Tool calls detected:', aiMessage.tool_calls.length);
      
      const toolResults = [];
      
      for (const toolCall of aiMessage.tool_calls) {
        const functionName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);
        
        console.log('Executing tool:', functionName, args);
        
        try {
          let result = { success: false, message: '' };
          
          switch (functionName) {
            case 'update_business_hours':
              const oldHours = company.hours;
              await supabase.from('companies').update({ hours: args.hours }).eq('id', company.id);
              result = { success: true, message: `✅ Hours updated\nFrom: ${oldHours}\nTo: ${args.hours}` };
              break;
              
            case 'update_services':
              const oldServices = company.services;
              await supabase.from('companies').update({ services: args.services }).eq('id', company.id);
              result = { success: true, message: `✅ Services/Menu updated\n\nNew menu:\n${args.services}` };
              break;
              
            case 'update_service_locations':
              const oldLocations = company.service_locations;
              await supabase.from('companies').update({ service_locations: args.locations }).eq('id', company.id);
              result = { success: true, message: `✅ Service locations updated\nFrom: ${oldLocations}\nTo: ${args.locations}` };
              break;
              
            case 'update_branches':
              const oldBranches = company.branches;
              await supabase.from('companies').update({ branches: args.branches }).eq('id', company.id);
              result = { success: true, message: `✅ Branches updated\nFrom: ${oldBranches}\nTo: ${args.branches}` };
              break;
              
            case 'update_payment_info':
              const updateData: any = {};
              const changes = [];
              if (args.mtn_number) {
                updateData.payment_number_mtn = args.mtn_number;
                changes.push(`MTN: ${args.mtn_number}`);
              }
              if (args.airtel_number) {
                updateData.payment_number_airtel = args.airtel_number;
                changes.push(`Airtel: ${args.airtel_number}`);
              }
              if (args.zamtel_number) {
                updateData.payment_number_zamtel = args.zamtel_number;
                changes.push(`Zamtel: ${args.zamtel_number}`);
              }
              if (args.payment_instructions) {
                updateData.payment_instructions = args.payment_instructions;
                changes.push(`Instructions updated`);
              }
              await supabase.from('companies').update(updateData).eq('id', company.id);
              result = { success: true, message: `✅ Payment info updated\n${changes.join('\n')}` };
              break;
              
            case 'update_voice_style':
              const oldVoice = company.voice_style;
              await supabase.from('companies').update({ voice_style: args.voice_style }).eq('id', company.id);
              result = { success: true, message: `✅ Voice style updated\nFrom: ${oldVoice}\nTo: ${args.voice_style}` };
              break;
              
            case 'update_ai_instructions':
              const aiUpdateData: any = {};
              const aiChanges = [];
              if (args.system_instructions !== undefined) {
                aiUpdateData.system_instructions = args.system_instructions;
                aiChanges.push('System instructions');
              }
              if (args.qa_style !== undefined) {
                aiUpdateData.qa_style = args.qa_style;
                aiChanges.push('Q&A style');
              }
              if (args.banned_topics !== undefined) {
                aiUpdateData.banned_topics = args.banned_topics;
                aiChanges.push('Banned topics');
              }
              
              // Check if override exists, insert or update
              const { data: existing } = await supabase
                .from('company_ai_overrides')
                .select('id')
                .eq('company_id', company.id)
                .single();
                
              if (existing) {
                await supabase.from('company_ai_overrides').update(aiUpdateData).eq('company_id', company.id);
              } else {
                await supabase.from('company_ai_overrides').insert({ company_id: company.id, ...aiUpdateData });
              }
              
              result = { success: true, message: `✅ AI instructions updated\nChanged: ${aiChanges.join(', ')}` };
              break;
              
            case 'update_quick_reference':
              const oldRef = company.quick_reference_info;
              await supabase.from('companies').update({ quick_reference_info: args.quick_reference_info }).eq('id', company.id);
              result = { success: true, message: `✅ Quick reference updated` };
              break;

            case 'get_all_customers':
              const { data: allCustomers } = await supabase
                .from('conversations')
                .select('customer_name, phone, created_at, status')
                .eq('company_id', company.id)
                .order('created_at', { ascending: false });
              
              const customerList = allCustomers?.map((c: any) => 
                `${c.customer_name || 'Unknown'} - ${c.phone || 'N/A'} (${c.status}, ${new Date(c.created_at).toLocaleDateString()})`
              ).join('\n') || 'No customers';
              
              result = { 
                success: true, 
                message: `Complete Customer Database (${allCustomers?.length || 0} total conversations, ${uniquePhones.size} unique customers):\n\n${customerList}` 
              };
              break;
              
            default:
              result = { success: false, message: `Unknown tool: ${functionName}` };
          }
          
          toolResults.push(result.message);
          
        } catch (error) {
          console.error(`Tool execution error for ${functionName}:`, error);
          const errorMsg = error instanceof Error ? error.message : String(error);
          toolResults.push(`❌ Error updating ${functionName}: ${errorMsg}`);
        }
      }
      
      // Combine tool results with AI response
      aiResponse = toolResults.join('\n\n') + (aiResponse ? '\n\n' + aiResponse : '');
    }
    
    console.log('Final AI response:', aiResponse.substring(0, 100) + '...');

    // Log management conversation
    await supabase
      .from('boss_conversations')
      .insert({
        company_id: company.id,
        message_from: 'management',
        message_content: Body,
        response: aiResponse
      });

    // Return JSON response (not TwiML) for whatsapp-messages to handle
    return new Response(JSON.stringify({ response: aiResponse }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error("Error in management-chat:", error);
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Error processing your request.</Message></Response>',
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
    );
  }
});
