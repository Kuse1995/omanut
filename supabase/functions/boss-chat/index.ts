import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Detect image generation commands from WhatsApp messages
function detectImageGenCommand(message: string): {
  isImageCommand: boolean;
  type: 'generate' | 'feedback' | 'caption' | 'suggest' | 'edit' | 'history' | null;
  prompt: string;
  feedbackData?: { feedbackType?: string };
} {
  const rawMsg = (message || '').trim();
  const lowerMsg = rawMsg.toLowerCase().trim();

  // Normalize polite prefixes so commands like "Can you make the image smaller" are detected
  const normalizedMsg = rawMsg
    .replace(/^(can you|could you|please|pls|kindly)\s+/i, '')
    .trim();
  const normalizedLower = normalizedMsg.toLowerCase();

  const tryMatch = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = normalizedMsg.match(pattern) || rawMsg.match(pattern);
      if (match) return match;
    }
    return null;
  };

  // History commands - view recent images (check first for priority)
  const historyPatterns = [
    /^show\s+(my\s+)?images?$/i,
    /^my\s+images?$/i,
    /^image\s+history$/i,
    /^recent\s+images?$/i,
    /^view\s+(my\s+)?images?$/i,
    /^list\s+(my\s+)?images?$/i,
    /^gallery$/i,
    /^📸$/,
    /^history$/i,
  ];

  for (const pattern of historyPatterns) {
    if (pattern.test(normalizedLower) || pattern.test(lowerMsg)) {
      return { isImageCommand: true, type: 'history', prompt: '' };
    }
  }

  // Edit image commands
  const editPatterns = [
    /^edit:\s*(.+)/i,
    /^✏️\s*(.+)/i,
    /^(make it|make the image|make this)\s+(.+)/i,
    // Handles: "make the image smaller", "make it bigger", etc.
    /^(make)\s+(the\s+)?(image|picture|photo|it)\s+(.+)/i,
    /^(add|remove|change|adjust|increase|decrease|brighten|darken)\s+(.+)/i,
    /^(more|less)\s+(bright|dark|contrast|saturation|vibrant|colorful)(.*)$/i,
    /^add\s+(text|overlay|watermark|logo|border|frame)\s*(.*)$/i,
    /^(crop|resize|rotate|flip|mirror)\s*(.*)$/i,
  ];

  const editMatch = tryMatch(editPatterns);
  if (editMatch) {
    let prompt = rawMsg;
    if (editMatch.length > 2) {
      prompt = `${editMatch[1]} ${editMatch[2]}`.trim();
    } else if (editMatch.length > 1) {
      prompt = editMatch[1]?.trim() || rawMsg;
    }

    // Keep the extracted prompt from the match

    if (prompt && prompt.length > 2) {
      return { isImageCommand: true, type: 'edit', prompt };
    }
  }

  // Generate image commands
  const generatePatterns = [
    /^(generate|create|make|design|draw)\s*(an?\s+)?(image|picture|photo|graphic|visual)\s*(of|for|with|showing)?\s*(.+)/i,
    /^image:\s*(.+)/i,
    /^img:\s*(.+)/i,
    /^🎨\s*(.+)/i,
    /^create\s*(.+)/i,
    /^generate\s+(.+)/i,
  ];

  const genMatch = tryMatch(generatePatterns);
  if (genMatch) {
    const prompt = genMatch[genMatch.length - 1]?.trim() || genMatch[1]?.trim();
    if (prompt && prompt.length > 3) {
      return { isImageCommand: true, type: 'generate', prompt };
    }
  }

  // Caption request
  if (
    normalizedLower.includes('caption') ||
    normalizedLower.includes('what to post') ||
    normalizedLower.includes('suggest text') ||
    lowerMsg.includes('caption') ||
    lowerMsg.includes('what to post') ||
    lowerMsg.includes('suggest text')
  ) {
    return { isImageCommand: true, type: 'caption', prompt: rawMsg };
  }

  // Suggestion request
  if (
    normalizedLower.includes('what should i post') ||
    normalizedLower.includes('post idea') ||
    normalizedLower.includes('content idea') ||
    normalizedLower.includes('suggest a post') ||
    lowerMsg.includes('what should i post') ||
    lowerMsg.includes('post idea') ||
    lowerMsg.includes('content idea') ||
    lowerMsg.includes('suggest a post')
  ) {
    return { isImageCommand: true, type: 'suggest', prompt: rawMsg };
  }

  // Feedback patterns
  if (normalizedLower.includes('👍') || normalizedLower.includes('love it') || normalizedLower.includes('great') || normalizedLower.includes('perfect') || lowerMsg.includes('👍') || lowerMsg.includes('love it') || lowerMsg.includes('great') || lowerMsg.includes('perfect')) {
    return { isImageCommand: true, type: 'feedback', prompt: rawMsg, feedbackData: { feedbackType: 'thumbs_up' } };
  }

  if (normalizedLower.includes('👎') || normalizedLower.includes('not good') || normalizedLower.includes('try again') || normalizedLower.includes('different') || lowerMsg.includes('👎') || lowerMsg.includes('not good') || lowerMsg.includes('try again') || lowerMsg.includes('different')) {
    return { isImageCommand: true, type: 'feedback', prompt: rawMsg, feedbackData: { feedbackType: 'thumbs_down' } };
  }

  return { isImageCommand: false, type: null, prompt: '' };
}

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
      .select('*, company_ai_overrides(*), company_documents(*), image_generation_settings(*)')
      .ilike('boss_phone', `%${normalizedFrom}%`)
      .single();

    if (companyError || !company) {
      console.error('Management phone not found:', From);
      return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        headers: { ...corsHeaders, 'Content-Type': 'text/xml' }
      });
    }

    console.log('Management company found:', company.name);

    const messageBody = (Body || '').trim().toLowerCase();

    // ========== HELP COMMAND DETECTION ==========
    if (messageBody === 'image help' || messageBody === 'img help' || messageBody === '🎨 help') {
      const helpText = `🎨 IMAGE GENERATION COMMANDS

Generate Images:
• "Generate an image of [description]"
• "Create a picture of [description]"
• "🎨 [description]"

Edit Last Image:
• "Edit: make it brighter"
• "Make it more colorful"
• "Add text overlay"

Get Captions:
• "Caption for [topic]"
• "What to post about [topic]"

Content Ideas:
• "What should I post?"
• "Suggest a post"
• "Content idea for [topic]"

View History:
• "Show my images"
• "Gallery"
• "📸"

Give Feedback:
• 👍 or "Love it" - Save style preferences
• 👎 or "Try again" - Request different style

Tip: The AI learns your style preferences from feedback!`;

      return new Response(JSON.stringify({
        response: helpText
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ========== IMAGE GENERATION COMMAND DETECTION ==========
    const imageGenCommand = detectImageGenCommand(Body || '');
    
    if (imageGenCommand.isImageCommand) {
      console.log(`[BOSS-IMAGE-GEN] Detected image command: type=${imageGenCommand.type}, prompt="${imageGenCommand.prompt?.substring(0, 50)}..."`);

      // Check if image generation is enabled for this company
      const imageSettings = Array.isArray(company.image_generation_settings)
        ? company.image_generation_settings[0]
        : company.image_generation_settings;

      console.log('[BOSS-IMAGE-GEN] Company image settings enabled:', imageSettings?.enabled);
      if (!imageSettings?.enabled) {
        console.log('[BOSS-IMAGE-GEN] Image generation not enabled for company');
        return new Response(JSON.stringify({
          response: "Image generation is not enabled for your company. Please enable it in the admin settings first."
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // Call whatsapp-image-gen function
      const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
      const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      
      const imageGenResponse = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-image-gen`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          companyId: company.id,
          customerPhone: '', // Empty to prevent whatsapp-image-gen from sending directly - boss-chat returns response for caller to send
          conversationId: null, // Boss doesn't have a conversation context
          prompt: imageGenCommand.prompt,
          messageType: imageGenCommand.type,
          feedbackData: imageGenCommand.feedbackData,
        }),
      });
      
      if (!imageGenResponse.ok) {
        const errorText = await imageGenResponse.text();
        console.error('[BOSS-IMAGE-GEN] Error from whatsapp-image-gen:', errorText);
        return new Response(JSON.stringify({
          response: "Sorry, there was an error generating the image. Please try again."
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      const imageGenResult = await imageGenResponse.json();
      console.log('[BOSS-IMAGE-GEN] Image generation result:', imageGenResult.success ? 'success' : 'failed');
      
      return new Response(JSON.stringify({
        response: imageGenResult.message || "Image generation complete!",
        imageUrl: imageGenResult.imageUrl,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    // ========== END IMAGE GENERATION DETECTION ==========

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

    const systemPrompt = `You are the Head of Sales & Marketing AI advisor for ${company.name}, a ${company.business_type}.

Your role is to analyze customer interactions, identify sales opportunities, and provide strategic marketing recommendations to drive revenue growth.

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

1. **Sales Analysis**: Calculate conversion rates (currently ${(totalConversations || 0) > 0 ? ((totalReservations || 0) / (totalConversations || 0) * 100).toFixed(1) : 0}%), identify hot leads from the ${uniquePhones.size} unique customers, spot sales patterns, and revenue opportunities.

2. **Marketing Strategy**: Recommend campaigns, pricing adjustments, promotional offers, and customer engagement tactics based on actual customer behavior.

3. **Customer Intelligence**: Analyze customer preferences, common objections, pain points, and buying triggers from conversations.

4. **Revenue Optimization**: Suggest upselling opportunities, product bundling, peak-time pricing, and menu/service optimization.

5. **Competitive Positioning**: Advise on market positioning, unique selling points, and differentiation strategies.

6. **Growth Planning**: Create actionable marketing plans, customer acquisition strategies, and retention programs.

7. **Content Scheduling (BE PROACTIVE!)**: You are a content marketing expert AND the Social Media Manager. When the boss mentions ANYTHING about marketing, promotions, sales, events, new products, or social media:
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

8. **Image Generation**: You CAN generate brand-aligned images directly in this WhatsApp chat!
   When the boss asks for an image, tell them to use commands like:
   - "Generate an image of [description]" or "🎨 [description]"
   - "Edit: [changes]" to modify the last image
   - "Show my images" to view recent creations
   NEVER say you cannot generate, create, or display images. You absolutely can.
   The image generation system handles it automatically when the boss uses these commands.
   
    For scheduling posts, you handle image generation automatically via the schedule_facebook_post tool.

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

RESPONSE GUIDELINES:
- Be PROACTIVE, not just reactive. When the boss shares business updates, suggest actionable next steps (schedule a post, send a promo, etc.)
- Keep responses SHORT. 2-4 lines for simple answers. Draft captions inline instead of asking what to write.
- When the boss mentions promotions, events, specials, or new products - IMMEDIATELY draft a social media post and ask when to schedule it
- Be direct and strategic - you're advising the owner/management
- Quantify opportunities when possible (e.g., "3 customers asked about X - potential revenue opportunity")
- Don't ask multiple questions in one message. Ask ONE thing at a time to keep the flow fast.

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
    
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
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
      .limit(6);

    // Build conversation messages with history (oldest first)
    const historyMessages = (recentHistory || []).reverse().flatMap((h: any) => [
      { role: 'user' as const, content: h.message_content },
      ...(h.response ? [{ role: 'assistant' as const, content: h.response }] : [])
    ]);

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: primaryModel,
        messages: [
          { role: 'system', content: finalSystemPrompt },
          ...historyMessages,
          { role: 'user', content: Body }
        ],
        temperature,
        max_tokens: maxTokens,
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
    let toolImageUrl: string | null = null;
    let toolMediaMessages: { body: string; imageUrl: string | null }[] = [];

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

            case 'schedule_social_post':
            case 'schedule_facebook_post': {
              const targetPlatform = args.target_platform || 'facebook';
              const isPublishNow = args.publish_now === true;
              const { data: metaCred } = await supabase
                .from('meta_credentials')
                .select('page_id')
                .eq('company_id', company.id)
                .limit(1)
                .maybeSingle();

              if (!metaCred?.page_id) {
                result = { success: false, message: '❌ No Facebook page connected for this company. Please set up Meta credentials first.' };
                break;
              }

              let imageUrl = args.image_url || null;

              // If boss wants image generation, call whatsapp-image-gen
              if (args.needs_image_generation && !imageUrl) {
                const imageSettings = Array.isArray(company.image_generation_settings)
                  ? company.image_generation_settings[0]
                  : company.image_generation_settings;

                if (imageSettings?.enabled) {
                  try {
                    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
                    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
                    const imgRes = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-image-gen`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                      },
                      body: JSON.stringify({
                        companyId: company.id,
                        customerPhone: '',
                        conversationId: null,
                        prompt: args.image_prompt || `Create a brand-aligned image for this Facebook post: ${args.content}`,
                        messageType: 'generate',
                      }),
                    });
                    if (imgRes.ok) {
                      const imgResult = await imgRes.json();
                      imageUrl = imgResult.imageUrl || null;
                      console.log('[BOSS-SCHEDULE] Generated image URL:', imageUrl);
                    }
                  } catch (imgErr) {
                    console.error('[BOSS-SCHEDULE] Image generation error:', imgErr);
                  }
                }
              }

              // Insert draft into scheduled_posts
              // Use a placeholder UUID for created_by since boss doesn't have a dashboard user ID
              const systemUserId = '00000000-0000-0000-0000-000000000000';
              const { data: newPost, error: insertError } = await supabase
                .from('scheduled_posts')
                .insert({
                  company_id: company.id,
                  page_id: metaCred.page_id,
                  content: args.content,
                  scheduled_time: isPublishNow ? new Date().toISOString() : args.scheduled_time,
                  image_url: imageUrl,
                  status: 'draft',
                  created_by: systemUserId,
                  target_platform: targetPlatform,
                })
                .select('id')
                .single();

              if (insertError || !newPost) {
                console.error('[BOSS-SCHEDULE] Insert error:', insertError);
                result = { success: false, message: `❌ Failed to create post draft: ${insertError?.message || 'Unknown error'}` };
                break;
              }

              const platformLabel = targetPlatform === 'both' ? 'Facebook + Instagram' : targetPlatform === 'instagram' ? 'Instagram' : 'Facebook';

              if (isPublishNow) {
                // Publish immediately via publish-meta-post
                const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
                const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
                const pubRes = await fetch(`${SUPABASE_URL}/functions/v1/publish-meta-post`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                  },
                  body: JSON.stringify({ post_id: newPost.id }),
                });
                const pubResult = await pubRes.json();
                if (!pubRes.ok || !pubResult.success) {
                  result = { success: false, message: `❌ Post draft created but publishing failed: ${pubResult.error || 'Unknown error'}` };
                  break;
                }
                result = {
                  success: true,
                  message: `✅ ${platformLabel} post published!\n\n📝 Content: ${args.content.substring(0, 100)}${args.content.length > 100 ? '...' : ''}\n📱 Platform: ${platformLabel}\n${imageUrl ? '🖼️ Image attached' : ''}\n🆔 Meta Post ID: ${pubResult.meta_post_id}`
                };
              } else {
                // Set to approved — cron-publisher will handle it at scheduled_time
                await supabase.from('scheduled_posts').update({ status: 'approved' }).eq('id', newPost.id);
                const scheduledDate = new Date(args.scheduled_time);
                result = {
                  success: true,
                  message: `✅ ${platformLabel} post approved & scheduled!\n\n📝 Content: ${args.content.substring(0, 100)}${args.content.length > 100 ? '...' : ''}\n📅 Scheduled for: ${scheduledDate.toLocaleString()}\n📱 Platform: ${platformLabel}\n${imageUrl ? '🖼️ Image attached' : ''}`
                };
              }
              break;
            }
              
            case 'update_agent_strategy': {
              const strategyUpdate: any = {};
              const stratChanges: string[] = [];
              if (args.posts_per_week !== undefined) { strategyUpdate.posts_per_week = args.posts_per_week; stratChanges.push(`Posts/week: ${args.posts_per_week}`); }
              if (args.target_audience !== undefined) { strategyUpdate.target_audience = args.target_audience; stratChanges.push(`Audience: ${args.target_audience}`); }
              if (args.preferred_tone !== undefined) { strategyUpdate.preferred_tone = args.preferred_tone; stratChanges.push(`Tone: ${args.preferred_tone}`); }
              if (args.content_themes !== undefined) { strategyUpdate.content_themes = args.content_themes; stratChanges.push(`Themes: ${args.content_themes.join(', ')}`); }
              if (args.preferred_posting_days !== undefined) { strategyUpdate.preferred_posting_days = args.preferred_posting_days; stratChanges.push(`Days: ${args.preferred_posting_days.join(', ')}`); }
              if (args.preferred_posting_time !== undefined) { strategyUpdate.preferred_posting_time = args.preferred_posting_time; stratChanges.push(`Time: ${args.preferred_posting_time}`); }
              if (args.notes !== undefined) { strategyUpdate.notes = args.notes; stratChanges.push(`Notes updated`); }

              const { data: existingSettings } = await supabase
                .from('agent_settings')
                .select('id')
                .eq('company_id', company.id)
                .maybeSingle();

              if (existingSettings) {
                await supabase.from('agent_settings').update({ ...strategyUpdate, updated_at: new Date().toISOString() }).eq('company_id', company.id);
              } else {
                await supabase.from('agent_settings').insert({ company_id: company.id, ...strategyUpdate });
              }
              result = { success: true, message: `✅ Social media strategy updated!\n${stratChanges.join('\n')}` };
              break;
            }

            case 'get_pending_posts': {
              const { data: pendingPosts } = await supabase
                .from('scheduled_posts')
                .select('id, content, image_url, scheduled_time, target_platform, created_at')
                .eq('company_id', company.id)
                .eq('status', 'pending_approval')
                .order('scheduled_time', { ascending: true });

              if (!pendingPosts || pendingPosts.length === 0) {
                result = { success: true, message: '📭 No posts pending approval right now. The queue is empty!' };
              } else {
                // Build per-post media messages array for multi-image WhatsApp delivery
                const mediaMessages: { body: string; imageUrl: string | null }[] = pendingPosts.map((p: any, i: number) => {
                  const time = new Date(p.scheduled_time);
                  const localTime = new Date(time.getTime() + 2 * 60 * 60 * 1000); // GMT+2
                  const caption = `Post ${i + 1}/${pendingPosts.length}: "${p.content.substring(0, 120)}${p.content.length > 120 ? '...' : ''}"\n📅 ${localTime.toLocaleDateString()} at ${localTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\n📱 ${p.target_platform}`;
                  return { body: caption, imageUrl: p.image_url || null };
                });
                // Add concluding prompt
                mediaMessages.push({ body: `📋 ${pendingPosts.length} post(s) shown above.\n\nWhich of these would you like to edit or approve?\nReply with "approve post [number]", "edit post [number]", or "reject post [number]".`, imageUrl: null });
                
                // Store mediaMessages for response — toolMediaMessages will be picked up below
                (result as any).__mediaMessages = mediaMessages;
                
                const postList = pendingPosts.map((p: any, i: number) => {
                  const time = new Date(p.scheduled_time);
                  const localTime = new Date(time.getTime() + 2 * 60 * 60 * 1000);
                  return `${i + 1}. 📝 "${p.content.substring(0, 80)}${p.content.length > 80 ? '...' : ''}"\n   📅 ${localTime.toLocaleDateString()} at ${localTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\n   📱 ${p.target_platform}\n   ${p.image_url ? '🖼️ Has image' : '📄 Text only'}`;
                }).join('\n\n');
                result = { ...result, success: true, message: `📋 ${pendingPosts.length} post(s) pending approval:\n\n${postList}\n\nReply with "approve post [number]", "edit post [number]", or "reject post [number]".` };
              }
              break;
            }

            case 'review_pending_post': {
              // Get pending posts to resolve index
              let targetPostId = args.post_id;
              if (!targetPostId && args.post_index) {
                const { data: pendingForReview } = await supabase
                  .from('scheduled_posts')
                  .select('id')
                  .eq('company_id', company.id)
                  .eq('status', 'pending_approval')
                  .order('scheduled_time', { ascending: true });

                if (!pendingForReview || args.post_index > pendingForReview.length || args.post_index < 1) {
                  result = { success: false, message: `❌ Post #${args.post_index} not found. Use "show pending posts" to see the current list.` };
                  break;
                }
                targetPostId = pendingForReview[args.post_index - 1].id;
              }

              if (!targetPostId) {
                result = { success: false, message: '❌ Please specify which post to review (e.g., "approve post 1").' };
                break;
              }

              if (args.action === 'approve') {
                // Set to approved — cron-publisher will publish at scheduled_time
                await supabase.from('scheduled_posts').update({ status: 'approved' }).eq('id', targetPostId);
                result = { success: true, message: `✅ Post approved! It will be published automatically at the scheduled time.` };
              } else if (args.action === 'edit') {
                const editData: any = {};
                const editChanges: string[] = [];
                if (args.new_caption) { editData.content = args.new_caption; editChanges.push('Caption updated'); }
                if (args.new_scheduled_time) { editData.scheduled_time = args.new_scheduled_time; editChanges.push('Time updated'); }
                if (args.new_image_url) { editData.image_url = args.new_image_url; editChanges.push('Image updated'); }
                await supabase.from('scheduled_posts').update(editData).eq('id', targetPostId);
                result = { success: true, message: `✏️ Post updated!\n${editChanges.join('\n')}\n\nSay "approve post" when ready to schedule it.` };
              } else if (args.action === 'approve_and_publish') {
                // Approve and publish immediately
                await supabase.from('scheduled_posts').update({ status: 'scheduled' }).eq('id', targetPostId);
                const SUPABASE_URL3 = Deno.env.get('SUPABASE_URL')!;
                const SRK3 = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
                const pubRes = await fetch(`${SUPABASE_URL3}/functions/v1/publish-meta-post`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SRK3}` },
                  body: JSON.stringify({ post_id: targetPostId }),
                });
                const pubResult = await pubRes.json();
                if (pubRes.ok && pubResult.success) {
                  result = { success: true, message: `✅ Post approved and published NOW!\n🆔 Meta Post ID: ${pubResult.meta_post_id}` };
                } else {
                  result = { success: false, message: `⚠️ Post approved but publishing failed: ${pubResult.error || 'Unknown error'}. You can retry with "publish post".` };
                }
              } else if (args.action === 'reject') {
                await supabase.from('scheduled_posts').update({ status: 'failed' }).eq('id', targetPostId);
                result = { success: true, message: '🗑️ Post rejected and removed from the queue.' };
              } else {
                result = { success: false, message: '❌ Unknown action. Use approve, edit, or reject.' };
              }
              break;
            }

            default:
              result = { success: false, message: `Unknown tool: ${functionName}` };
          }
          
          toolResults.push(result.message);
          
          // Capture mediaMessages from get_pending_posts
          if ((result as any).__mediaMessages) {
            toolMediaMessages = (result as any).__mediaMessages;
          }
          
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
    const responsePayload: any = { response: aiResponse };
    if (toolImageUrl) responsePayload.imageUrl = toolImageUrl;
    if (toolMediaMessages) responsePayload.mediaMessages = toolMediaMessages;
    
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
