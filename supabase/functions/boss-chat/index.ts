import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { geminiChat } from "../_shared/gemini-client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Image command detection removed — unified into AI supervisor tools

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { From, Body, ProfileName, companyId } = await req.json();

    console.log('Management message received:', { From, Body, ProfileName });

    // Normalize phone numbers for comparison
    const normalizePhone = (phone: string) => {
      return phone.replace(/^whatsapp:/i, '').replace(/\+/g, '').replace(/\s/g, '');
    };
    
    const normalizedFrom = normalizePhone(From || '');

    // Find company - prefer companyId if provided (avoids duplicate boss_phone conflicts)
    let company: any = null;
    let companyError: any = null;

    if (companyId) {
      const result = await supabase
        .from('companies')
        .select('*, company_ai_overrides(*), company_documents(*), image_generation_settings(*)')
        .eq('id', companyId)
        .single();
      company = result.data;
      companyError = result.error;
    } else {
      // Fallback: find by management phone (may fail if multiple companies share same boss_phone)
      const result = await supabase
        .from('companies')
        .select('*, company_ai_overrides(*), company_documents(*), image_generation_settings(*)')
        .ilike('boss_phone', `%${normalizedFrom}%`)
        .limit(1)
        .maybeSingle();
      company = result.data;
      companyError = result.error;
    }

    if (companyError || !company) {
      console.error('Management phone not found:', From);
      return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        headers: { ...corsHeaders, 'Content-Type': 'text/xml' }
      });
    }

    console.log('Management company found:', company.name);

    const messageBody = (Body || '').trim().toLowerCase();

    // Image help command — simplified, AI handles everything now
    if (messageBody === 'image help' || messageBody === 'img help' || messageBody === '🎨 help') {
      const helpText = `🎨 IMAGE GENERATION

Just describe what you want naturally! Examples:

"Generate an image of a boy drinking from the LifeStraw Family 2.0"
"Edit the last image - make it brighter"
"Show my recent images"
"Create a promotional image for our weekend special and post it on Facebook"

The AI handles everything - generation, editing, posting. Just ask!`;

      return new Response(JSON.stringify({
        response: helpText
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

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
    
    // ========== BOSS REPORTING CONFIGURATION ==========
    const bossReportingStyle = aiOverrides?.boss_reporting_style || 'concise';
    const bossDataFocus = aiOverrides?.boss_data_focus || ['revenue', 'conversations', 'reservations'];
    const bossAlertTriggers = aiOverrides?.boss_alert_triggers || { low_engagement: true, missed_opportunities: true, negative_feedback: true };
    const bossDailyBriefingTemplate = aiOverrides?.boss_daily_briefing_template || '';
    const bossMetricGoals = aiOverrides?.boss_metric_goals || { daily_revenue: 0, weekly_conversations: 0, conversion_rate: 0 };
    const bossPreferredLanguage = aiOverrides?.boss_preferred_language || 'en';
    const bossComparisonPeriod = aiOverrides?.boss_comparison_period || 'last_week';
    
    // Build reporting style instructions
    let reportingStyleInstructions = '';
    switch (bossReportingStyle) {
      case 'concise':
        reportingStyleInstructions = 'Keep responses brief and use bullet points. Focus on key metrics and actionable insights.';
        break;
      case 'detailed':
        reportingStyleInstructions = 'Provide detailed narrative explanations with context and analysis. Explain trends and patterns.';
        break;
      case 'data_heavy':
        reportingStyleInstructions = 'Lead with numbers and metrics. Include percentages, comparisons, and data visualizations in text form.';
        break;
      case 'executive':
        reportingStyleInstructions = 'Provide executive-level summaries focusing on strategic implications and high-level trends.';
        break;
    }
    
    // Build data focus instructions
    const dataFocusInstructions = `PRIORITIZE DATA IN REPORTS:\n${bossDataFocus.map((f: string) => `- ${f.replace(/_/g, ' ').toUpperCase()}`).join('\n')}`;
    
    // Build goal comparison instructions
    let goalInstructions = '';
    if (bossMetricGoals.daily_revenue > 0 || bossMetricGoals.weekly_conversations > 0 || bossMetricGoals.conversion_rate > 0) {
      goalInstructions = `\n\nGOALS TO COMPARE AGAINST:
${bossMetricGoals.daily_revenue > 0 ? `- Daily Revenue Target: ${company.currency_prefix}${bossMetricGoals.daily_revenue}` : ''}
${bossMetricGoals.weekly_conversations > 0 ? `- Weekly Conversation Target: ${bossMetricGoals.weekly_conversations}` : ''}
${bossMetricGoals.conversion_rate > 0 ? `- Conversion Rate Target: ${bossMetricGoals.conversion_rate}%` : ''}
Always compare actual performance against these goals when providing updates.`;
    }
    
    // Build language instruction
    const languageInstruction = bossPreferredLanguage !== 'en' 
      ? `\n\nIMPORTANT: Respond in ${bossPreferredLanguage === 'es' ? 'Spanish' : bossPreferredLanguage === 'fr' ? 'French' : bossPreferredLanguage === 'pt' ? 'Portuguese' : bossPreferredLanguage === 'sw' ? 'Swahili' : bossPreferredLanguage === 'zu' ? 'Zulu' : 'English'}.` 
      : '';
    
    // Build comparison period instruction
    const comparisonInstruction = `\n\nDEFAULT COMPARISON: When comparing data, use ${bossComparisonPeriod.replace(/_/g, ' ')} as the default comparison period.`;
    
    // Build daily briefing template instruction
    const briefingInstruction = bossDailyBriefingTemplate 
      ? `\n\nDAILY BRIEFING FORMAT:\n${bossDailyBriefingTemplate}` 
      : '';

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

    const systemPrompt = `You are the trusted right-hand business partner for ${company.name}, a ${company.business_type}.

You're both a strategic advisor and a great conversationalist. The boss can bounce ideas off you, brainstorm strategy, vent about a tough day, or ask you to execute tasks — and you know when to do which. Think of yourself as a smart business partner they're texting on WhatsApp, not a system they're issuing commands to.

=== REPORTING STYLE ===
${reportingStyleInstructions}
${dataFocusInstructions}
${goalInstructions}
${comparisonInstruction}
${briefingInstruction}
${languageInstruction}

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
${bossDataFocus.includes('conversations') ? conversationsSummary : '(Conversations data not prioritized)'}

${demoBookingsSummary}

${bossDataFocus.includes('reservations') ? reservationsSummary : '(Reservations data not prioritized)'}

${bossDataFocus.includes('action_items') ? actionItemsSummary : '(Action items data not prioritized)'}

${bossDataFocus.includes('customer_insights') ? clientInsightsSummary : '(Client insights data not prioritized)'}

${bossDataFocus.includes('revenue') ? paymentSummary : '(Payment data not prioritized)'}

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
- REAL-TIME inventory and sales data via the Business Management System (BMS)

10. **Inventory & Sales (BMS)**: You have REAL-TIME access to the business inventory system.
   - Use check_stock to look up current stock levels and pricing for any product
   - Use record_sale to log completed sales with customer details
   - Use update_stock to adjust inventory quantities (restock, corrections, damage write-offs)
   - Use sales_report to get sales summaries with date range filters
   - Use get_low_stock_items to see which products need restocking
   - When the boss asks about stock, inventory, or product availability - use check_stock IMMEDIATELY
   - When the boss confirms a sale or wants to record a transaction - use record_sale
   - When the boss asks "how are sales?" or "what did we sell today?" - use sales_report

11. **Finance & Accounting (BMS)**: You have access to financial management tools.
   - Use record_expense to log business expenses (rent, supplies, transport, etc.)
   - Use get_expenses to view expense history with date/category filters
   - Use get_outstanding_receivables to see unpaid invoices (who owes you)
   - Use get_outstanding_payables to see pending bills (what you owe)
   - Use profit_loss_report to generate P&L statements for any date range
   - Use create_quotation and create_invoice for formal business documents
     - Use generate_document to create BEAUTIFUL branded PDF documents and send them via WhatsApp

12. **HR & Attendance (BMS)**: You can track employee attendance.
    - Use clock_in when the boss says someone has arrived or started work
    - Use clock_out when an employee is leaving or finished for the day
    - The BMS automatically calculates work hours

13. **Document Generation (PDF)**: You can create professional branded PDF documents!
     - Use generate_document to turn ANY report or document into a polished PDF
     - Supported types: invoice, quotation, sales_report, expense_report, profit_loss, receivables, payables, stock_report
     - WORKFLOW: First fetch the data, then pass the result to generate_document
     - "send me the sales report as PDF" → call sales_report → then generate_document with the result
     - "create a quotation for X" → call create_quotation → then generate_document with quotation type and the data
     - PDFs include company branding, header, footer, and professional formatting
     - PDFs are automatically sent to the boss via WhatsApp
     - NEVER dump raw JSON to the boss. Always format data nicely or generate a PDF.

MULTI-STEP TOOL CHAINING (CRITICAL):
You can call multiple tools across multiple rounds. After each tool call, you receive the result and can use it to make subsequent tool calls. You MUST complete the full workflow in one conversation turn. Examples:

QUOTATION WORKFLOW:
1. Boss says "create a quotation for Company X, 4 LifeStraw Max"
2. YOU call check_stock for "LifeStraw Max" to get current unit price
3. YOU receive the stock data with the price
4. YOU call create_quotation with the correct unit_price from step 3
5. YOU call generate_document with the quotation data to create a PDF
6. YOU respond with a confirmation message

INVOICE WORKFLOW: Same pattern - check_stock for prices → create_invoice → generate_document

SALES REPORT PDF: sales_report → generate_document

NEVER stop after just fetching data. If the boss asked you to CREATE something, complete ALL steps (fetch data → create document → generate PDF if needed).

1. **Sales Analysis**: Calculate conversion rates (currently ${(totalConversations || 0) > 0 ? ((totalReservations || 0) / (totalConversations || 0) * 100).toFixed(1) : 0}%), identify hot leads from the ${uniquePhones.size} unique customers, spot sales patterns, and revenue opportunities.

2. **Marketing Strategy**: Recommend campaigns, pricing adjustments, promotional offers, and customer engagement tactics based on actual customer behavior.

3. **Customer Intelligence**: Analyze customer preferences, common objections, pain points, and buying triggers from conversations.

4. **Revenue Optimization**: Suggest upselling opportunities, product bundling, peak-time pricing, and menu/service optimization.

5. **Competitive Positioning**: Advise on market positioning, unique selling points, and differentiation strategies.

6. **Growth Planning**: Create actionable marketing plans, customer acquisition strategies, and retention programs.

7. **Content Scheduling (BE PROACTIVE!)**: You are a content marketing expert AND the Social Media Manager. When the boss mentions marketing, promotions, sales, events, new products, or social media AND seems ready to act (not just brainstorming or discussing strategy):
   - PROACTIVELY suggest scheduling a Facebook post about it
   - Draft the caption yourself based on the context - don't ask "what do you want to say?"
   - ALWAYS offer to generate a brand-aligned image (default to yes)
   - Ask only the essentials: "When should I post this?" if they haven't specified a time
   - Use the schedule_facebook_post tool with needs_image_generation=true by default
   
   IDEAL FLOW (2-3 messages max):
   Boss: "We have a weekend special on grilled chicken"
   You: "Great! I'll draft a post for your weekend special:
   
   🔥 Weekend Special Alert! 🍗
   Enjoy our signature grilled chicken at a special price this weekend only!
   Visit us before Sunday - limited offer!
   
   I'll generate a brand image to go with it. When should I post this?"
   
   Boss: "Post it tomorrow at 10am"
   You: [calls schedule_facebook_post with content, time, and needs_image_generation=true]
   
   DO NOT ask multiple questions. Draft the caption immediately and only ask for the time.
   Parse dates from natural language. Scheduled time must be 10+ min from now, within 75 days.
    Current UTC time: ${new Date().toISOString()}
    The boss is in the Africa/Lusaka timezone (GMT+2). When the boss says a time like "07:00", they mean 07:00 local time (which is 05:00 UTC). ALWAYS convert local times to UTC by subtracting 2 hours before setting scheduled_time. For example: "tomorrow at 7am" → scheduled_time should be "...T05:00:00Z".

8. **Image Generation**: You have DIRECT tools to generate and edit brand-aligned images!
   - Use the generate_image tool when the boss asks for any image creation. Extract a detailed visual prompt from their message.
   - Use the edit_image tool when they want to modify the last generated image.
   - Use the show_image_gallery tool when they want to see recent creations.
   - You can CHAIN tools: generate an image, then schedule it as a social post in the SAME turn!
   - NEVER say you cannot generate images. Use the generate_image tool directly.
   
   ⚠️ BRANDING LOCK: Image generation is STRICTLY reference-locked. The system will ONLY generate images when it finds a confident match in uploaded product photos. If no match is found, it will ask to check the product library first.
   
   PRODUCT IMAGE VERIFICATION: You have a list_product_images tool!
   - Use it when the boss asks "show me my product photos" or "what product images do I have"
   - PROACTIVELY suggest using it if the boss reports inaccurate image generation results
   
    IMAGE REUSE RULE (CRITICAL): If you already called generate_image in this conversation and got an imageUrl back, you MUST pass that URL as image_url to schedule_social_post. Do NOT set needs_image_generation=true when an image was already generated and approved. The system will automatically reuse the last generated image, but explicitly passing image_url is preferred.

9. **Social Media Strategy Management**: You manage the full content approval queue via WhatsApp.
   - Use get_pending_posts to check what AI-generated content is waiting for approval
   - Use review_pending_post to approve, edit, or reject pending posts
   - Use update_agent_strategy to update the posting strategy (frequency, audience, tone, themes)
   - When the boss asks "what's pending?" or "any posts to review?" - fetch and summarize pending posts
    - When the boss says "approve post 1" or "change the caption on post 2" - use review_pending_post
    - "approve" = schedule for its planned future time. "approve and publish" / "post now" / "publish post 1" = publish IMMEDIATELY
    - When the boss says "post 3 times a week" or "target young professionals" - use update_agent_strategy
   - ALWAYS number the pending posts (1, 2, 3...) so the boss can refer to them easily
   - When showing pending posts, include a SHORT preview of the caption and the scheduled time

READING THE BOSS'S INTENT:
- Thinking out loud ("I'm considering...", "what do you think about...", "should we...", "I was wondering...")
  → ENGAGE in conversation. Share your perspective, ask a follow-up question, explore the idea together. Do NOT call tools yet.
- Asking for information ("how are sales?", "what did we sell?", "any pending posts?")
  → Use tools to fetch data, then discuss the results naturally.
- Clear directive ("post this", "check stock on X", "approve post 2", "schedule for 10am")
  → Execute immediately with tools.
- Sharing news or frustration ("sales were slow today", "a customer complained", "we had a great day")
  → Acknowledge genuinely, offer your insight or encouragement, THEN suggest a concrete next step.
- When unsure → lean toward conversation. It's better to ask one clarifying question than to execute the wrong thing.

RESPONSE GUIDELINES:
- Be PROACTIVE, not just reactive. When the boss shares business updates, suggest actionable next steps (schedule a post, send a promo, etc.)
- Match your length to the moment. Quick confirmations stay short (2-4 lines). Strategy discussions, brainstorming, or explaining results — take the space needed to be genuinely helpful. Never write walls of text, but don't cut yourself off mid-thought either.
- When the boss mentions promotions, events, specials, or new products and is ready to act - draft a social media post and ask when to schedule it
- Be direct and strategic - you're advising the owner/management
- Quantify opportunities when possible (e.g., "3 customers asked about X - potential revenue opportunity")
- Don't ask multiple questions in one message. Ask ONE thing at a time to keep the flow fast.
- Be personable and warm. This is a WhatsApp conversation, not a report.
- When the boss shares an idea, acknowledge it genuinely before adding your take.
- Use natural language ("That could work really well because..." not "Recommendation: implement X").

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
      },
      {
        type: "function",
        function: {
          name: "schedule_social_post",
          description: "Schedule a social media post to Facebook, Instagram, or both. Parse the boss's message to extract the post content, desired publish time, and target platform. If the boss wants an image generated, set needs_image_generation to true. Instagram requires an image.",
          parameters: {
            type: "object",
            properties: {
              content: { type: "string", description: "The text content of the post" },
              scheduled_time: { type: "string", description: "ISO 8601 timestamp in UTC. Convert boss's local time (GMT+2) to UTC by subtracting 2 hours. E.g., boss says 7am → use 05:00:00Z. Ignored when publish_now is true." },
              publish_now: { type: "boolean", description: "Set to true to publish immediately instead of scheduling. When true, scheduled_time is ignored." },
              image_url: { type: "string", description: "Optional URL of an existing image to attach" },
              needs_image_generation: { type: "boolean", description: "Set to true if the boss wants AI to generate a brand image for this post" },
              image_prompt: { type: "string", description: "Detailed description of what the generated image should depict, extracted from the boss's message. E.g., 'Zambian preteens reading in a Bible study'. Always extract the boss's specific visual description separately from the post caption." },
              target_platform: { type: "string", enum: ["facebook", "instagram", "both"], description: "Where to publish: facebook, instagram, or both. Default to 'facebook' if not specified. If boss mentions Instagram or IG, use 'instagram'. If boss says 'all platforms' or 'everywhere', use 'both'." }
            },
            required: ["content"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_agent_strategy",
          description: "Update the social media posting strategy. Use when the boss says things like 'post 3 times a week', 'target young professionals', 'use a casual tone', 'focus on promotions and events'.",
          parameters: {
            type: "object",
            properties: {
              posts_per_week: { type: "integer", description: "Number of posts per week (1-14)" },
              target_audience: { type: "string", description: "Description of the target audience" },
              preferred_tone: { type: "string", description: "Tone of voice for posts (e.g., professional, casual, fun, inspirational)" },
              content_themes: { type: "array", items: { type: "string" }, description: "List of content themes to focus on (e.g., promotions, behind-the-scenes, customer stories)" },
              preferred_posting_days: { type: "array", items: { type: "string" }, description: "Days of the week to post (e.g., Monday, Wednesday, Friday)" },
              preferred_posting_time: { type: "string", description: "Preferred time to post (e.g., '10:00')" },
              notes: { type: "string", description: "Any additional strategy notes" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_pending_posts",
          description: "Fetch all social media posts awaiting approval. Use when the boss asks 'what posts are pending?', 'anything to review?', 'show me the queue', etc.",
          parameters: {
            type: "object",
            properties: {},
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "review_pending_post",
          description: "Approve, edit, or reject a pending post. The boss refers to posts by number (e.g., 'approve post 1', 'change caption on post 2', 'reject post 3'). The post_index is the 1-based position from the most recent get_pending_posts result.",
          parameters: {
            type: "object",
            properties: {
              post_index: { type: "integer", description: "1-based index of the post from the pending list" },
              post_id: { type: "string", description: "UUID of the post (if known directly)" },
              action: { type: "string", enum: ["approve", "edit", "reject", "approve_and_publish"], description: "What to do with the post. Use 'approve' to schedule for its planned time, 'approve_and_publish' to publish immediately right now, 'edit' to change caption/time, 'reject' to remove." },
              new_caption: { type: "string", description: "Updated caption text (only for 'edit' action)" },
              new_scheduled_time: { type: "string", description: "Updated ISO 8601 scheduled time in UTC (only for 'edit' action)" },
              new_image_url: { type: "string", description: "Updated image URL (only for 'edit' action)" }
            },
            required: ["action"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_hot_leads",
          description: "Get the hottest cross-platform leads from WhatsApp, Facebook, Instagram, and Messenger. Use when the boss asks about leads, hot leads, facebook leads, instagram leads, ads leads, or new inquiries.",
          parameters: {
            type: "object",
            properties: {
              hours_back: { type: "integer", description: "How many hours back to look (default 24)" },
              platform_filter: { type: "string", enum: ["all", "whatsapp", "facebook", "instagram", "messenger"], description: "Filter by platform (default all)" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "check_stock",
          description: "Check real-time inventory stock levels and pricing for a product from the Business Management System. Use when the boss asks about stock, inventory, availability, or how many items are in stock.",
          parameters: {
            type: "object",
            properties: {
              product_name: { type: "string", description: "Name or partial name of the product to look up" }
            },
            required: ["product_name"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "record_sale",
          description: "Record a completed sale in the Business Management System. Use when the boss confirms a sale or wants to log a transaction.",
          parameters: {
            type: "object",
            properties: {
              product_name: { type: "string", description: "Name of the product sold" },
              quantity: { type: "integer", description: "Number of units sold" },
              payment_method: { type: "string", description: "Payment method used (e.g., cash, mobile_money, card)" },
              customer_name: { type: "string", description: "Name of the customer" },
              customer_phone: { type: "string", description: "Phone number of the customer" }
            },
            required: ["product_name", "quantity"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_stock",
          description: "Update stock quantity for a product in the BMS. Use when the boss wants to adjust inventory levels, restock, or correct quantities.",
          parameters: {
            type: "object",
            properties: {
              product_name: { type: "string", description: "Name of the product to update" },
              quantity: { type: "integer", description: "New quantity or adjustment amount" },
              adjustment_type: { type: "string", enum: ["set", "add", "subtract"], description: "How to apply the quantity: 'set' replaces, 'add' increases, 'subtract' decreases. Default: 'set'" },
              reason: { type: "string", description: "Reason for the adjustment (e.g., 'restock', 'damaged', 'audit correction')" }
            },
            required: ["product_name", "quantity"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "sales_report",
          description: "Get a sales report with optional date range. Use when the boss asks about sales performance, revenue, or what was sold.",
          parameters: {
            type: "object",
            properties: {
              start_date: { type: "string", description: "Start date filter (YYYY-MM-DD)" },
              end_date: { type: "string", description: "End date filter (YYYY-MM-DD)" },
              limit: { type: "integer", description: "Max results to return" }
            },
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_order_status",
          description: "Check the status of a customer order. Use when the boss asks about a specific order's progress.",
          parameters: {
            type: "object",
            properties: {
              order_number: { type: "string", description: "The order number (e.g., ORD-2026-0042)" },
              order_id: { type: "string", description: "The order ID if known" }
            },
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_order_status",
          description: "Update the status of a customer order (e.g., mark as shipped, delivered, processing). Use when the boss wants to change an order's status.",
          parameters: {
            type: "object",
            properties: {
              order_id: { type: "string", description: "The order ID" },
              order_number: { type: "string", description: "The order number" },
              status: { type: "string", description: "New status: pending, confirmed, processing, shipped, delivered, cancelled" },
              notes: { type: "string", description: "Notes about the status change" }
            },
            required: ["status"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "cancel_order",
          description: "Cancel a customer order. Use when the boss wants to cancel an order.",
          parameters: {
            type: "object",
            properties: {
              order_number: { type: "string", description: "The order number to cancel" },
              order_id: { type: "string", description: "The order ID" },
              reason: { type: "string", description: "Reason for cancellation" }
            },
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_customer_history",
          description: "Look up a customer's purchase history, orders, and invoices. Use when the boss asks about a specific customer's history.",
          parameters: {
            type: "object",
            properties: {
              customer_name: { type: "string", description: "Customer name to search" },
              customer_phone: { type: "string", description: "Customer phone number" }
            },
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_company_statistics",
          description: "Get overall company statistics including total revenue, sales count, and impact metrics.",
          parameters: {
            type: "object",
            properties: {},
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "create_quotation",
          description: "Create a quotation for a customer. Use when the boss wants to send a price quote or estimate.",
          parameters: {
            type: "object",
            properties: {
              client_name: { type: "string", description: "Name of the client" },
              items: { type: "array", items: { type: "object", properties: { description: { type: "string" }, quantity: { type: "integer" }, unit_price: { type: "number" } }, required: ["description", "quantity", "unit_price"] }, description: "Line items for the quotation" },
              client_phone: { type: "string", description: "Client phone number" },
              client_email: { type: "string", description: "Client email" },
              notes: { type: "string", description: "Additional notes" },
              tax_rate: { type: "number", description: "Tax rate percentage" }
            },
            required: ["client_name", "items"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "create_invoice",
          description: "Create an invoice for a customer. Use when the boss wants to generate a bill or invoice.",
          parameters: {
            type: "object",
            properties: {
              client_name: { type: "string", description: "Name of the client" },
              items: { type: "array", items: { type: "object", properties: { description: { type: "string" }, quantity: { type: "integer" }, unit_price: { type: "number" } }, required: ["description", "quantity", "unit_price"] }, description: "Line items for the invoice" },
              client_phone: { type: "string", description: "Client phone number" },
              client_email: { type: "string", description: "Client email" },
              due_date: { type: "string", description: "Due date (YYYY-MM-DD)" },
              notes: { type: "string", description: "Additional notes" },
              tax_rate: { type: "number", description: "Tax rate percentage" }
            },
            required: ["client_name", "items"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_low_stock_items",
          description: "Get all products that are at or below their reorder level. Use when the boss asks about low stock, items to reorder, or inventory warnings.",
          parameters: { type: "object", properties: {}, required: [] }
        }
      },
      {
        type: "function",
        function: {
          name: "record_expense",
          description: "Record a business expense in the BMS. Use when the boss mentions spending, paying a supplier, or recording a cost.",
          parameters: {
            type: "object",
            properties: {
              category: { type: "string", description: "Expense category (e.g., rent, utilities, supplies, transport)" },
              vendor_name: { type: "string", description: "Name of the vendor or supplier" },
              amount_zmw: { type: "number", description: "Amount in ZMW" },
              date_incurred: { type: "string", description: "Date of expense (YYYY-MM-DD). Defaults to today." },
              notes: { type: "string", description: "Additional notes about the expense" }
            },
            required: ["category", "vendor_name", "amount_zmw"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_expenses",
          description: "Get a list of recorded expenses. Use when the boss asks about spending, costs, or expense history.",
          parameters: {
            type: "object",
            properties: {
              start_date: { type: "string", description: "Start date filter (YYYY-MM-DD)" },
              end_date: { type: "string", description: "End date filter (YYYY-MM-DD)" },
              category: { type: "string", description: "Filter by expense category" },
              limit: { type: "integer", description: "Max results to return" }
            },
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_outstanding_receivables",
          description: "Get unpaid invoices and total outstanding receivables. Use when the boss asks who owes them money, unpaid invoices, or accounts receivable.",
          parameters: { type: "object", properties: {}, required: [] }
        }
      },
      {
        type: "function",
        function: {
          name: "get_outstanding_payables",
          description: "Get pending vendor bills and total outstanding payables. Use when the boss asks what bills are due, what they owe, or accounts payable.",
          parameters: { type: "object", properties: {}, required: [] }
        }
      },
      {
        type: "function",
        function: {
          name: "profit_loss_report",
          description: "Generate a profit and loss report for a date range. Use when the boss asks about profitability, P&L, net profit, or financial performance.",
          parameters: {
            type: "object",
            properties: {
              start_date: { type: "string", description: "Start date (YYYY-MM-DD)" },
              end_date: { type: "string", description: "End date (YYYY-MM-DD)" }
            },
            required: ["start_date", "end_date"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "clock_in",
          description: "Clock in an employee for attendance tracking. Use when the boss says someone has arrived or started work.",
          parameters: {
            type: "object",
            properties: {
              employee_name: { type: "string", description: "Name of the employee" },
              employee_id: { type: "string", description: "Employee ID if known" },
              notes: { type: "string", description: "Optional notes (e.g., late arrival reason)" }
            },
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "clock_out",
          description: "Clock out an employee. Use when the boss says someone is leaving or has finished work.",
          parameters: {
            type: "object",
            properties: {
              employee_name: { type: "string", description: "Name of the employee" },
              employee_id: { type: "string", description: "Employee ID if known" },
              notes: { type: "string", description: "Optional notes" }
            },
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "generate_document",
          description: "Generate a professionally formatted PDF document and send it to the boss via WhatsApp. Use when the boss asks for a PDF, document, report, or says 'send me the invoice/quotation/report as PDF'. First fetch the data using the appropriate BMS tool (sales_report, profit_loss_report, etc.), then call this tool with the results.",
          parameters: {
            type: "object",
            properties: {
              document_type: { type: "string", enum: ["invoice", "quotation", "sales_report", "expense_report", "profit_loss", "receivables", "payables", "stock_report"], description: "Type of document to generate" },
              data: { type: "object", description: "The document data. For invoices/quotations: { client_name, items: [{description, quantity, unit_price}], tax_rate, notes, valid_until }. For reports: pass the BMS response data directly." }
            },
            required: ["document_type", "data"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "list_product_images",
          description: "List all uploaded product images in the company media library. Use when the boss wants to see what product photos are available, or before generating images to verify which products have reference photos.",
          parameters: {
            type: "object",
            properties: {
              category: { type: "string", description: "Optional filter: 'products', 'promotional', 'logos', etc. Defaults to 'products'." }
            },
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "generate_image",
          description: "Generate a brand-aligned image using the company's product reference library. Use when the boss asks to create, generate, make, or design any image. Extract a detailed visual prompt from their message.",
          parameters: {
            type: "object",
            properties: {
              prompt: { type: "string", description: "Detailed description of the image to generate. Include product names, scene details, and any specific visual requirements mentioned by the boss." }
            },
            required: ["prompt"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "edit_image",
          description: "Edit or modify the most recently generated image. Use when the boss asks to change, adjust, make brighter/darker, add text, crop, resize, or otherwise modify an existing image.",
          parameters: {
            type: "object",
            properties: {
              instructions: { type: "string", description: "Description of changes to make to the last generated image" }
            },
            required: ["instructions"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "show_image_gallery",
          description: "Show the boss their recently generated images. Use when they ask to see their images, gallery, history, or recent creations.",
          parameters: {
            type: "object",
            properties: {},
            required: []
          }
        }
      }
    ];

    // ========== DYNAMIC AI CONFIGURATION FROM DATABASE ==========
    // Use AI overrides from company_ai_overrides table instead of hardcoded values
    const primaryModel = aiOverrides?.primary_model || 'google/gemini-3-pro-preview';
    const temperature = aiOverrides?.primary_temperature || 1.0;
    const maxTokens = aiOverrides?.max_tokens || 8192;
    const bossAgentPrompt = aiOverrides?.boss_agent_prompt;
    
    // If there's a custom boss agent prompt, append it to the system prompt
    const finalSystemPrompt = bossAgentPrompt 
      ? `${systemPrompt}\n\n=== CUSTOM BOSS AGENT INSTRUCTIONS ===\n${bossAgentPrompt}`
      : systemPrompt;
    
    // AI calls use geminiChat() with GEMINI_API_KEY
    
    console.log('Boss chat request:', { 
      companyName: company.name, 
      question: Body,
      aiConfig: { primaryModel, temperature, maxTokens, hasBossPrompt: !!bossAgentPrompt }
    });
    
    // Fetch recent conversation history for multi-turn context
    const { data: recentHistory } = await supabase
      .from('boss_conversations')
      .select('message_content, response, created_at')
      .eq('company_id', company.id)
      .order('created_at', { ascending: false })
      .limit(12);

    // Build conversation messages with history (oldest first)
    const historyMessages = (recentHistory || []).reverse().flatMap((h: any) => [
      { role: 'user' as const, content: h.message_content },
      ...(h.response ? [{ role: 'assistant' as const, content: h.response }] : [])
    ]);

    // ========== MULTI-ROUND TOOL EXECUTION LOOP ==========
    // Allows AI to chain tools: e.g. check_stock → create_quotation → generate_document
    const MAX_TOOL_ROUNDS = 5;
    let conversationMessages: any[] = [
      { role: 'system', content: finalSystemPrompt },
      ...historyMessages,
      { role: 'user', content: Body }
    ];
    let aiResponse = '';
    let toolImageUrl: string | null = null;
    let toolMediaMessages: { body: string; imageUrl: string | null }[] = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      console.log(`[BOSS-CHAT] Tool round ${round + 1}/${MAX_TOOL_ROUNDS}`);

      const response = await geminiChat({
        model: primaryModel,
        messages: conversationMessages,
        temperature,
        max_tokens: maxTokens,
        tools: managementTools
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

      // No tool calls — this is the final text response
      if (!aiMessage.tool_calls || aiMessage.tool_calls.length === 0) {
        aiResponse = aiMessage.content || '';
        console.log(`[BOSS-CHAT] Final response after ${round + 1} round(s)`);
        break;
      }

      // Has tool calls — execute them and feed results back
      console.log(`[BOSS-CHAT] Round ${round + 1}: ${aiMessage.tool_calls.length} tool call(s)`);

      // Append the assistant message (with tool_calls) to conversation
      conversationMessages.push({
        role: 'assistant',
        content: aiMessage.content || null,
        tool_calls: aiMessage.tool_calls
      });

      for (const toolCall of aiMessage.tool_calls) {
        const functionName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);

        console.log(`[BOSS-CHAT] Executing tool: ${functionName}`, args);

        let result = { success: false, message: '' };

        try {
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
              
            case 'update_payment_info': {
              const updateData: any = {};
              const changes: string[] = [];
              if (args.mtn_number) { updateData.payment_number_mtn = args.mtn_number; changes.push(`MTN: ${args.mtn_number}`); }
              if (args.airtel_number) { updateData.payment_number_airtel = args.airtel_number; changes.push(`Airtel: ${args.airtel_number}`); }
              if (args.zamtel_number) { updateData.payment_number_zamtel = args.zamtel_number; changes.push(`Zamtel: ${args.zamtel_number}`); }
              if (args.payment_instructions) { updateData.payment_instructions = args.payment_instructions; changes.push(`Instructions updated`); }
              await supabase.from('companies').update(updateData).eq('id', company.id);
              result = { success: true, message: `✅ Payment info updated\n${changes.join('\n')}` };
              break;
            }
              
            case 'update_voice_style':
              const oldVoice = company.voice_style;
              await supabase.from('companies').update({ voice_style: args.voice_style }).eq('id', company.id);
              result = { success: true, message: `✅ Voice style updated\nFrom: ${oldVoice}\nTo: ${args.voice_style}` };
              break;
              
            case 'update_ai_instructions': {
              const aiUpdateData: any = {};
              const aiChanges: string[] = [];
              if (args.system_instructions !== undefined) { aiUpdateData.system_instructions = args.system_instructions; aiChanges.push('System instructions'); }
              if (args.qa_style !== undefined) { aiUpdateData.qa_style = args.qa_style; aiChanges.push('QA style'); }
              if (args.banned_topics !== undefined) { aiUpdateData.banned_topics = args.banned_topics; aiChanges.push('Banned topics'); }
              if (aiOverrides) {
                await supabase.from('company_ai_overrides').update(aiUpdateData).eq('company_id', company.id);
              } else {
                await supabase.from('company_ai_overrides').insert({ company_id: company.id, ...aiUpdateData });
              }
              result = { success: true, message: `✅ AI instructions updated: ${aiChanges.join(', ')}` };
              break;
            }

            case 'update_quick_reference':
              await supabase.from('companies').update({ quick_reference_info: args.quick_reference_info }).eq('id', company.id);
              result = { success: true, message: '✅ Quick reference info updated' };
              break;

            case 'get_all_customers': {
              const { data: allConvs } = await supabase
                .from('conversations')
                .select('customer_name, phone, started_at, status')
                .eq('company_id', company.id)
                .not('phone', 'is', null)
                .order('started_at', { ascending: false });
              const customerMap = new Map();
              for (const c of allConvs || []) {
                if (!customerMap.has(c.phone)) customerMap.set(c.phone, c);
              }
              const customerList = Array.from(customerMap.values()).map((c: any) =>
                `${c.customer_name || 'Unknown'} - ${c.phone}`
              ).join('\n');
              result = { success: true, message: customerList || 'No customers found' };
              break;
            }

            case 'schedule_social_post': {
              const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
              const SUPABASE_SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

              // PRIORITY: Use explicit image_url > toolImageUrl (from prior generate_image) > generate new
              let postImageUrl = args.image_url || null;
              if (!postImageUrl && toolImageUrl) {
                console.log('[BOSS-CHAT] Reusing toolImageUrl for social post:', toolImageUrl);
                postImageUrl = toolImageUrl;
              }

              // ── IMAGE-FIRST PIPELINE ──
              // When needs_image_generation is true, generate the image BEFORE publishing.
              // Never silently degrade to text-only.
              const needsImageGen = !postImageUrl && args.needs_image_generation && args.image_prompt;
              let imageGenFailed = false;

              if (needsImageGen) {
                try {
                  const IMG_TIMEOUT = 90000; // 90s — generous for quality generation
                  const imgGenPromise = fetch(`${SUPABASE_URL}/functions/v1/whatsapp-image-gen`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SRK}` },
                    body: JSON.stringify({
                      companyId: company.id,
                      customerPhone: '',
                      conversationId: null,
                      prompt: args.image_prompt,
                      messageType: 'generate',
                    }),
                  });
                  const timeoutPromise = new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('Image generation timed out')), IMG_TIMEOUT)
                  );
                  const imgGenResponse = await Promise.race([imgGenPromise, timeoutPromise]) as Response;
                  if (imgGenResponse.ok) {
                    const imgResult = await imgGenResponse.json();
                    if (imgResult.imageUrl) {
                      postImageUrl = imgResult.imageUrl;
                      toolImageUrl = imgResult.imageUrl; // Store for reuse in conversation
                    } else {
                      imageGenFailed = true;
                    }
                  } else {
                    imageGenFailed = true;
                  }
                } catch (e: any) {
                  console.error('[BOSS-CHAT] Image gen for post failed/timed out:', e.message);
                  imageGenFailed = true;
                }
              }

              // Get meta credentials (needed for both publish_now and schedule)
              const { data: metaCred } = await supabase
                .from('meta_credentials')
                .select('page_id')
                .eq('company_id', company.id)
                .limit(1)
                .maybeSingle();

              if (!metaCred?.page_id) {
                result = { success: false, message: '❌ No Meta page connected. Please connect your Facebook/Instagram page first.' };
                break;
              }

              const targetPlatform = args.target_platform || 'facebook';

              // Deduplication: check for identical post in last 2 minutes
              const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
              const { data: existingPost } = await supabase
                .from('scheduled_posts')
                .select('id, status, image_url')
                .eq('company_id', company.id)
                .eq('content', args.content)
                .eq('target_platform', targetPlatform)
                .gte('created_at', twoMinAgo)
                .limit(1)
                .maybeSingle();

              if (existingPost) {
                result = {
                  success: true,
                  message: `✅ This post was already created moments ago. No duplicate needed.`,
                  imageUrl: existingPost.image_url || undefined,
                };
                break;
              }

              if (args.publish_now) {
                if (imageGenFailed) {
                  // Image gen failed — insert as pending_image and trigger async generation
                  const { data: pendingPost, error: pendingErr } = await supabase
                    .from('scheduled_posts')
                    .insert({
                      company_id: company.id,
                      page_id: metaCred.page_id,
                      content: args.content,
                      image_url: null,
                      target_platform: targetPlatform,
                      status: 'pending_image',
                      scheduled_time: new Date().toISOString(),
                    })
                    .select('id')
                    .single();

                  if (pendingErr || !pendingPost) {
                    result = { success: false, message: `❌ Failed to create post: ${pendingErr?.message || 'Unknown error'}` };
                    break;
                  }

                  // Fire-and-forget async image generation with scheduledPostId callback
                  fetch(`${SUPABASE_URL}/functions/v1/whatsapp-image-gen`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SRK}` },
                    body: JSON.stringify({
                      companyId: company.id,
                      customerPhone: '',
                      conversationId: null,
                      prompt: args.image_prompt,
                      messageType: 'generate',
                      scheduledPostId: pendingPost.id,
                      bossPhone: company.boss_phone,
                    }),
                  }).catch(e => console.error('[BOSS-CHAT] Async image gen fire-and-forget error:', e.message));

                  result = {
                    success: true,
                    message: `⏳ Image is still generating. I'll publish your post automatically once the image is ready and send you a preview. No action needed from you!`,
                  };
                } else {
                  // Image ready (or no image needed) — publish immediately
                  const { data: insertedPost, error: insertErr } = await supabase
                    .from('scheduled_posts')
                    .insert({
                      company_id: company.id,
                      page_id: metaCred.page_id,
                      content: args.content,
                      image_url: postImageUrl,
                      target_platform: targetPlatform,
                      status: 'approved',
                      scheduled_time: new Date().toISOString(),
                    })
                    .select('id')
                    .single();

                  if (insertErr || !insertedPost) {
                    result = { success: false, message: `❌ Failed to create post: ${insertErr?.message || 'Unknown error'}` };
                    break;
                  }

                  const publishResponse = await fetch(`${SUPABASE_URL}/functions/v1/publish-meta-post`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SRK}` },
                    body: JSON.stringify({ post_id: insertedPost.id }),
                  });
                  const publishResult = await publishResponse.json();
                  result = publishResult.success !== false
                    ? { success: true, message: `✅ Post published now!\n${postImageUrl ? '🖼️ With brand image' : '📝 Text only'}`, imageUrl: postImageUrl || undefined }
                    : { success: false, message: `❌ Failed to publish: ${publishResult.error || 'Unknown error'}` };
                }
              } else {
                // Schedule for later
                if (imageGenFailed) {
                  // Insert as pending_image — async gen will update before scheduled time
                  const { data: pendingPost, error: pendingErr } = await supabase
                    .from('scheduled_posts')
                    .insert({
                      company_id: company.id,
                      page_id: metaCred.page_id,
                      content: args.content,
                      image_url: null,
                      target_platform: targetPlatform,
                      status: 'pending_image',
                      scheduled_time: args.scheduled_time,
                    })
                    .select('id')
                    .single();

                  if (!pendingErr && pendingPost) {
                    fetch(`${SUPABASE_URL}/functions/v1/whatsapp-image-gen`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SRK}` },
                      body: JSON.stringify({
                        companyId: company.id,
                        customerPhone: '',
                        conversationId: null,
                        prompt: args.image_prompt,
                        messageType: 'generate',
                        scheduledPostId: pendingPost.id,
                        bossPhone: company.boss_phone,
                      }),
                    }).catch(e => console.error('[BOSS-CHAT] Async image gen for scheduled post error:', e.message));
                  }

                  result = {
                    success: true,
                    message: `✅ Post scheduled for ${args.scheduled_time}\n⏳ Image is generating — it'll be attached automatically before publishing.`,
                  };
                } else {
                  const scheduleResponse = await fetch(`${SUPABASE_URL}/functions/v1/schedule-meta-post`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SRK}` },
                    body: JSON.stringify({
                      companyId: company.id,
                      content: args.content,
                      scheduledTime: args.scheduled_time,
                      imageUrl: postImageUrl,
                      targetPlatform: targetPlatform,
                      status: 'approved',
                    }),
                  });
                  const schedResult = await scheduleResponse.json();
                  result = schedResult.error
                    ? { success: false, message: `❌ Scheduling failed: ${schedResult.error}` }
                    : { success: true, message: `✅ Post scheduled for ${args.scheduled_time}\n${postImageUrl ? '🖼️ With brand image' : '📝 Text only'}`, imageUrl: postImageUrl || undefined };
                }
              }
              break;
            }

            case 'update_agent_strategy': {
              const strategyUpdate: any = {};
              if (args.posts_per_week) strategyUpdate.posts_per_week = args.posts_per_week;
              if (args.target_audience) strategyUpdate.target_audience = args.target_audience;
              if (args.preferred_tone) strategyUpdate.preferred_tone = args.preferred_tone;
              if (args.content_themes) strategyUpdate.content_themes = args.content_themes;
              if (args.preferred_posting_days) strategyUpdate.preferred_posting_days = args.preferred_posting_days;
              if (args.preferred_posting_time) strategyUpdate.preferred_posting_time = args.preferred_posting_time;
              if (args.notes) strategyUpdate.notes = args.notes;

              const { data: existing } = await supabase
                .from('agent_settings')
                .select('id')
                .eq('company_id', company.id)
                .maybeSingle();
              if (existing) {
                await supabase.from('agent_settings').update(strategyUpdate).eq('company_id', company.id);
              } else {
                await supabase.from('agent_settings').insert({ company_id: company.id, ...strategyUpdate });
              }
              result = { success: true, message: `✅ Strategy updated: ${Object.keys(strategyUpdate).join(', ')}` };
              break;
            }

            case 'get_pending_posts': {
              const { data: pendingPosts } = await supabase
                .from('scheduled_posts')
                .select('*')
                .eq('company_id', company.id)
                .in('status', ['pending_approval', 'draft'])
                .order('created_at', { ascending: false })
                .limit(10);
              if (!pendingPosts?.length) {
                result = { success: true, message: 'No pending posts to review! 🎉' };
              } else {
                const postsList = pendingPosts.map((p: any, i: number) =>
                  `${i + 1}. ${p.content?.substring(0, 80)}...\n   📅 ${p.scheduled_time || 'No time set'} | ${p.target_platform || 'facebook'}${p.image_url ? ' | 🖼️' : ''}`
                ).join('\n\n');
                result = { success: true, message: `📋 ${pendingPosts.length} posts pending:\n\n${postsList}` };
              }
              break;
            }

            case 'review_pending_post': {
              const { data: allPending } = await supabase
                .from('scheduled_posts')
                .select('*')
                .eq('company_id', company.id)
                .in('status', ['pending_approval', 'draft'])
                .order('created_at', { ascending: false })
                .limit(10);
              const postId = args.post_id || (allPending && args.post_index ? allPending[args.post_index - 1]?.id : null);
              if (!postId) {
                result = { success: false, message: '❌ Could not find that post. Try get_pending_posts first.' };
              } else if (args.action === 'approve') {
                await supabase.from('scheduled_posts').update({ status: 'approved' }).eq('id', postId);
                result = { success: true, message: '✅ Post approved and scheduled!' };
              } else if (args.action === 'approve_and_publish') {
                const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
                const SUPABASE_SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
                const post = allPending?.find((p: any) => p.id === postId);
                if (post) {
                  // Set status to 'approved' first so publish-meta-post accepts it
                  await supabase.from('scheduled_posts').update({ status: 'approved' }).eq('id', postId);
                  const publishResponse = await fetch(`${SUPABASE_URL}/functions/v1/publish-meta-post`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SRK}` },
                    body: JSON.stringify({ post_id: postId }),
                  });
                  const pubResult = await publishResponse.json();
                  if (pubResult.success) {
                    result = { success: true, message: '✅ Post published immediately!' };
                  } else {
                    result = { success: false, message: `❌ Publish failed: ${pubResult.error || 'Unknown error'}` };
                  }
                } else {
                  result = { success: false, message: '❌ Post not found for publishing' };
                }
              } else if (args.action === 'edit') {
                const editUpdate: any = {};
                if (args.new_caption) editUpdate.content = args.new_caption;
                if (args.new_scheduled_time) editUpdate.scheduled_time = args.new_scheduled_time;
                if (args.new_image_url) editUpdate.image_url = args.new_image_url;
                await supabase.from('scheduled_posts').update(editUpdate).eq('id', postId);
                result = { success: true, message: '✅ Post updated!' };
              } else if (args.action === 'reject') {
                await supabase.from('scheduled_posts').update({ status: 'rejected' }).eq('id', postId);
                result = { success: true, message: '✅ Post rejected and removed from queue.' };
              } else {
                result = { success: false, message: '❌ Unknown action. Use approve, edit, reject, or approve_and_publish.' };
              }
              break;
            }

            case 'get_hot_leads': {
              const hoursBack = args.hours_back || 24;
              const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
              let query = supabase
                .from('conversations')
                .select('customer_name, phone, platform, started_at, status, last_message_preview')
                .eq('company_id', company.id)
                .gte('started_at', cutoff)
                .order('started_at', { ascending: false })
                .limit(20);
              if (args.platform_filter && args.platform_filter !== 'all') {
                query = query.eq('platform', args.platform_filter);
              }
              const { data: leads } = await query;
              if (!leads?.length) {
                result = { success: true, message: `No new leads in the last ${hoursBack} hours.` };
              } else {
                const leadsList = leads.map((l: any, i: number) =>
                  `${i + 1}. ${l.customer_name || 'Unknown'} (${l.phone || 'N/A'}) via ${l.platform}\n   "${l.last_message_preview?.substring(0, 60) || 'No preview'}..."`
                ).join('\n\n');
                result = { success: true, message: `🔥 ${leads.length} leads (last ${hoursBack}h):\n\n${leadsList}` };
              }
              break;
            }

            // ========== BMS TOOLS (with streaming ack for slow calls) ==========
            case 'check_stock':
            case 'record_sale':
            case 'update_stock':
            case 'sales_report':
            case 'get_order_status':
            case 'update_order_status':
            case 'cancel_order':
            case 'get_customer_history':
            case 'get_company_statistics':
            case 'create_quotation':
            case 'create_invoice':
            case 'get_low_stock_items':
            case 'record_expense':
            case 'get_expenses':
            case 'get_outstanding_receivables':
            case 'get_outstanding_payables':
            case 'profit_loss_report':
            case 'clock_in':
            case 'clock_out': {
              // bms-agent handles connection resolution internally via bms-connection.ts

              // Streaming ack config
              const BMS_ACK_TIMEOUT = 8000;
              const bmsAckMessages: Record<string, string> = {
                check_stock: "Checking inventory... 🔍", get_product_variants: "Checking options... 🔍",
                sales_report: "Pulling up reports... 📊", get_company_statistics: "Pulling up stats... 📊",
                profit_loss_report: "Generating P&L... 📊", get_expenses: "Looking up expenses... 📊",
                get_outstanding_receivables: "Checking receivables... 📊", get_outstanding_payables: "Checking payables... 📊",
                create_order: "Processing order... 🛒", record_sale: "Recording sale... 🛒",
                create_quotation: "Generating quotation... 📄", create_invoice: "Generating invoice... 📄",
                get_order_status: "Checking order status... 📦", cancel_order: "Processing cancellation... ❌",
                get_customer_history: "Looking up history... 📋", get_low_stock_items: "Checking low stock... ⚠️",
                clock_in: "Clocking in... ⏰", clock_out: "Clocking out... ⏰",
                record_expense: "Recording expense... 💰", update_stock: "Updating stock... 📦",
              };

              try {
                const bmsFetchFn = () => fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/bms-agent`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                  },
                  body: JSON.stringify({
                    action: functionName,
                    params: args,
                    companyId: company.id,
                  }),
                });

                // Race: BMS fetch vs ack timeout
                const resultPromise = bmsFetchFn().then(r => r.json());
                const ackPromise = new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), BMS_ACK_TIMEOUT));
                const race = await Promise.race([
                  resultPromise.then(data => ({ type: 'data' as const, data })),
                  ackPromise.then(() => ({ type: 'timeout' as const }))
                ]);

                let bmsResult: any;
                if (race.type === 'timeout') {
                  // Send ack to boss via Twilio
                  const ackMsg = bmsAckMessages[functionName] || "Working on that... ⏳";
                  const TWILIO_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
                  const TWILIO_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
                  if (TWILIO_SID && TWILIO_TOKEN && company.boss_phone && company.whatsapp_number) {
                    const fromNum = company.whatsapp_number.startsWith('whatsapp:') ? company.whatsapp_number : `whatsapp:${company.whatsapp_number}`;
                    const toNum = company.boss_phone.startsWith('whatsapp:') ? company.boss_phone : `whatsapp:${company.boss_phone}`;
                    const fd = new URLSearchParams();
                    fd.append('From', fromNum);
                    fd.append('To', toNum);
                    fd.append('Body', ackMsg);
                    fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
                      method: 'POST',
                      headers: { 'Authorization': 'Basic ' + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`), 'Content-Type': 'application/x-www-form-urlencoded' },
                      body: fd.toString(),
                    }).catch(e => console.error('[BOSS-ACK] Failed:', e));
                    console.log(`[BOSS-ACK] Sent: "${ackMsg}" for ${functionName}`);
                  }
                  bmsResult = await resultPromise;
                } else {
                  bmsResult = race.data;
                }

                if (bmsResult.success) {
                  // Format BMS results with emoji indicators for boss
                  let formatted = '';
                  const d = bmsResult.data;
                  switch (functionName) {
                    case 'check_stock': {
                      if (Array.isArray(d)) {
                        formatted = d.map((p: any) => {
                          const qty = p.current_stock ?? p.quantity ?? 0;
                          const price = p.unit_price ?? p.selling_price ?? 0;
                          const status = qty <= 0 ? '🔴' : qty <= (p.reorder_level || 5) ? '🟡' : '🟢';
                          return `${status} ${p.name}: ${qty} in stock @ ${company.currency_prefix}${price}`;
                        }).join('\n');
                      } else if (d?.name) {
                        const qty = d.current_stock ?? d.quantity ?? 0;
                        const price = d.unit_price ?? d.selling_price ?? 0;
                        const status = qty <= 0 ? '🔴' : qty <= (d.reorder_level || 5) ? '🟡' : '🟢';
                        formatted = `${status} ${d.name}: ${qty} in stock @ ${company.currency_prefix}${price}`;
                      } else {
                        formatted = JSON.stringify(d);
                      }
                      break;
                    }
                    case 'record_sale':
                      formatted = `✅ Sale recorded!\n${d.product_name || args.product_name} x${args.quantity}\nTotal: ${company.currency_prefix}${d.total_amount || 'N/A'}`;
                      break;
                    case 'update_stock':
                      formatted = `✅ Stock updated for ${args.product_name}\nNew quantity: ${d.new_quantity ?? 'updated'}`;
                      break;
                    case 'get_low_stock_items':
                      if (Array.isArray(d) && d.length > 0) {
                        formatted = d.map((p: any) => `⚠️ ${p.name}: ${p.quantity} left (reorder at ${p.reorder_level})`).join('\n');
                      } else {
                        formatted = '✅ All stock levels are healthy!';
                      }
                      break;
                    default:
                      formatted = typeof d === 'string' ? d : JSON.stringify(d, null, 2);
                  }
                  result = { success: true, message: formatted };
                } else {
                  result = { success: false, message: `❌ BMS error: ${bmsResult.error || 'Unknown error'}` };
                }
              } catch (bmsErr: any) {
                console.error(`[BOSS-BMS] ${functionName} error:`, bmsErr);
                result = { success: false, message: `❌ BMS connection error: ${bmsErr.message}` };
              }
              break;
            }

            case 'generate_document': {
              const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
              const SUPABASE_SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
              try {
                const docResponse = await fetch(`${SUPABASE_URL}/functions/v1/generate-document`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SRK}` },
                  body: JSON.stringify({
                    company_id: company.id,
                    document_type: args.document_type,
                    data: args.data,
                    send_whatsapp: true,
                  }),
                });
                const docResult = await docResponse.json();
                if (docResult.success) {
                  const docLabel = args.document_type.replace(/_/g, ' ').toUpperCase();
                  if (docResult.whatsapp_sent) {
                    result = { success: true, message: `✅ ${docLabel} PDF generated and sent to your WhatsApp!` };
                  } else {
                    // PDF generated but WhatsApp delivery failed - provide fallback link
                    result = { 
                      success: true, 
                      message: `✅ ${docLabel} PDF generated!\n\n⚠️ Couldn't deliver to WhatsApp, but you can download it here:\n${docResult.pdf_url}`,
                      pdf_url: docResult.pdf_url
                    };
                  }
                } else {
                  result = { success: false, message: `❌ Document generation failed: ${docResult.error || 'Unknown error'}` };
                }
              } catch (docErr: any) {
                result = { success: false, message: `❌ Document generation error: ${docErr.message}` };
              }
              break;
            }

            case 'list_product_images': {
              const category = args.category || 'products';
              const { data: mediaItems } = await supabase
                .from('company_media')
                .select('file_name, description, tags, category')
                .eq('company_id', company.id)
                .eq('category', category)
                .order('created_at', { ascending: false })
                .limit(20);
              if (!mediaItems?.length) {
                result = { success: true, message: `No ${category} images found in the media library.` };
              } else {
                const list = mediaItems.map((m: any, i: number) =>
                  `${i + 1}. ${m.file_name}${m.description ? ` - ${m.description}` : ''}${m.tags?.length ? ` [${m.tags.join(', ')}]` : ''}`
                ).join('\n');
                result = { success: true, message: `📸 ${mediaItems.length} ${category} images:\n\n${list}` };
              }
              break;
            }

            case 'generate_image':
            case 'edit_image': {
              const imageSettings = Array.isArray(company.image_generation_settings)
                ? company.image_generation_settings[0]
                : company.image_generation_settings;

              if (!imageSettings?.enabled) {
                result = { success: false, message: 'Image generation is not enabled for your company. Please enable it in the admin settings first.' };
                break;
              }

              const SUPABASE_URL_IMG = Deno.env.get('SUPABASE_URL')!;
              const SUPABASE_SRK_IMG = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
              const messageType = functionName === 'generate_image' ? 'generate' : 'edit';
              const imgPrompt = functionName === 'generate_image' ? args.prompt : args.instructions;

              // Check if a previous round already fired async image gen — don't stack them
              if ((globalThis as any).__imageGenInProgress) {
                console.log(`[BOSS-TOOL-${functionName}] Skipping — async image gen already in progress from previous round`);
                result = { success: true, message: '🎨 Image is already generating in the background. It will be sent to you via WhatsApp when ready. Do NOT request another image.' };
                break;
              }

              const IMG_GEN_TIMEOUT = 30000;
              const imgGenBody = {
                companyId: company.id,
                customerPhone: '',
                conversationId: null,
                prompt: imgPrompt,
                messageType,
                bossPhone: company.boss_phone || '',
              };

              try {
                const imgGenPromise = fetch(`${SUPABASE_URL_IMG}/functions/v1/whatsapp-image-gen`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SRK_IMG}` },
                  body: JSON.stringify(imgGenBody),
                });
                const timeoutPromise = new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error('Image generation timed out')), IMG_GEN_TIMEOUT)
                );
                const imageGenResponse = await Promise.race([imgGenPromise, timeoutPromise]) as Response;

                if (!imageGenResponse.ok) {
                  const errorText = await imageGenResponse.text();
                  console.error(`[BOSS-TOOL-${functionName}] Error:`, errorText);
                  result = { success: false, message: 'Sorry, there was an error with image generation. Please try again.' };
                } else {
                  const imageGenResult = await imageGenResponse.json();
                  result = { success: imageGenResult.success !== false, message: imageGenResult.message || 'Image operation complete!' };
                  if (imageGenResult.imageUrl) {
                    toolImageUrl = imageGenResult.imageUrl;
                    toolMediaMessages.push({
                      body: imageGenResult.message || '🎨 Here is your generated image!',
                      imageUrl: imageGenResult.imageUrl
                    });
                  }
                }
              } catch (timeoutErr: any) {
                console.error(`[BOSS-TOOL-${functionName}] Timeout — firing async with bossPhone delivery`);
                // Fire-and-forget: the image-gen function will deliver via WhatsApp when done
                fetch(`${SUPABASE_URL_IMG}/functions/v1/whatsapp-image-gen`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SRK_IMG}` },
                  body: JSON.stringify(imgGenBody),
                }).catch(e => console.error('[BOSS-TOOL] Async image gen fire failed:', e));
                (globalThis as any).__imageGenInProgress = true;
                result = { success: true, message: '🎨 Image is generating asynchronously. It will be delivered to you via WhatsApp shortly. Do NOT request another image — it is already being created.' };
              }
              break;
            }

            case 'show_image_gallery': {
              const { data: recentImages } = await supabase
                .from('generated_images')
                .select('prompt, image_url, created_at, status')
                .eq('company_id', company.id)
                .order('created_at', { ascending: false })
                .limit(5);
              if (!recentImages?.length) {
                result = { success: true, message: 'No images generated yet. Ask me to create one!' };
              } else {
                const gallery = recentImages.map((img: any, i: number) =>
                  `${i + 1}. "${img.prompt.substring(0, 60)}..." (${img.status}) - ${new Date(img.created_at).toLocaleDateString()}`
                ).join('\n');
                result = { success: true, message: `🖼️ Recent images:\n\n${gallery}` };
                // Send the most recent image
                if (recentImages[0]?.image_url) {
                  toolImageUrl = recentImages[0].image_url;
                  toolMediaMessages.push({
                    body: '🖼️ Your most recent image:',
                    imageUrl: recentImages[0].image_url
                  });
                }
              }
              break;
            }

            default:
              result = { success: false, message: `Unknown tool: ${functionName}` };
          }

          // Push tool result as a message for multi-round context
          conversationMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: typeof result.message === 'string' ? result.message : JSON.stringify(result)
          });

        } catch (error) {
          console.error(`Tool execution error for ${functionName}:`, error);
          const errorMsg = error instanceof Error ? error.message : String(error);
          conversationMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `❌ Error: ${errorMsg}`
          });
        }
      }

      // If this was the last round and we still have tool calls, use whatever text we have
      if (round === MAX_TOOL_ROUNDS - 1) {
        aiResponse = aiResponse || 'I completed the requested operations. Let me know if you need anything else!';
        console.log(`[BOSS-CHAT] Max rounds reached, returning with current response`);
      }
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
    const responsePayload: any = { response: aiResponse };
    if (toolImageUrl) responsePayload.imageUrl = toolImageUrl;
    if (toolMediaMessages.length > 0) {
      // If there's also an AI text response, append it as a final text-only message
      if (aiResponse && aiResponse.trim()) {
        toolMediaMessages.push({ body: aiResponse, imageUrl: null });
      }
      responsePayload.mediaMessages = toolMediaMessages;
    }

    return new Response(JSON.stringify(responsePayload), {
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
