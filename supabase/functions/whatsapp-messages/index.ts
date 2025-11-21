import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://deno.land/x/zod@v3.21.4/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Message complexity classifier
function classifyMessageComplexity(message: string): 'simple' | 'complex' {
  const simpleTriggers = [
    /^(hi|hello|hey|good morning|good afternoon|good evening|how are you)/i,
    /^(yes|no|yeah|yep|nope|ok|okay|sure|thanks|thank you|alright)/i,
    /how much|price|cost|hours|location|address|phone|email/i,
    /^what (is|are) (your|the)/i,
    /^(can i|do you|are you)/i,
  ];
  
  const complexTriggers = [
    /book|reserve|reservation|appointment|schedule/i,
    /pay|payment|invoice|receipt|transaction/i,
    /complain|problem|issue|wrong|disappointed|unhappy|frustrated/i,
    /why|how does|explain|tell me about|describe/i,
    /urgent|asap|immediately|emergency/i,
  ];
  
  const lowerMsg = message.toLowerCase().trim();
  
  // Check complex first (higher priority)
  if (complexTriggers.some(pattern => pattern.test(lowerMsg))) {
    return 'complex';
  }
  
  if (simpleTriggers.some(pattern => pattern.test(lowerMsg))) {
    return 'simple';
  }
  
  // Default to simple for short messages
  if (lowerMsg.length < 50) return 'simple';
  
  return 'complex';
}

// Agent routing function using DeepSeek for intent classification
async function routeToAgent(
  userMessage: string,
  conversationHistory: any[]
): Promise<{ agent: 'support' | 'sales' | 'boss'; reasoning: string; confidence: number }> {
  
  const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY');
  
  // Build recent conversation context (last 5 messages)
  const recentContext = conversationHistory
    .slice(-5)
    .map(m => `${m.role === 'user' ? 'Customer' : 'AI'}: ${m.content}`)
    .join('\n');
  
  const routingPrompt = `You are an intent classification system for a WhatsApp business AI.

ANALYZE the customer's message and conversation context to determine the BEST agent to handle this:

AGENT OPTIONS:
1. **SUPPORT** - Customer needs help, has a complaint, problem, or question (non-sales)
   - Keywords: "issue", "problem", "wrong", "broken", "not working", "help", "how to", "why", "confused", "disappointed", "frustrated"
   - Intent: Resolve issues, answer questions, handle complaints

2. **SALES** - Customer is shopping, asking about products/pricing, showing buying intent
   - Keywords: "price", "cost", "buy", "purchase", "order", "available", "options", "recommend", "best", "show me"
   - Intent: Convert to sale, persuade, close deal

3. **BOSS** - Payment discussion OR critical issue requiring human escalation
   - Keywords: "pay", "payment", "transfer", "invoice", "receipt", "money", OR extremely upset customer
   - Intent: Human must handle payment or critical situation

CONVERSATION CONTEXT:
${recentContext}

CURRENT MESSAGE:
${userMessage}

Respond with ONLY valid JSON (no markdown):
{
  "agent": "support" | "sales" | "boss",
  "reasoning": "Brief explanation (1 sentence)",
  "confidence": 0.0-1.0
}`;

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: 'You are an intent classifier. Respond only with valid JSON.' },
          { role: 'user', content: routingPrompt }
        ],
        temperature: 0.3,
        max_tokens: 150
      })
    });
    
    const data = await response.json();
    const content = data.choices[0]?.message?.content || '{}';
    
    // Parse JSON response
    const result = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
    
    return {
      agent: result.agent || 'sales',
      reasoning: result.reasoning || 'Classification failed, defaulting to sales',
      confidence: result.confidence || 0.5
    };
    
  } catch (error) {
    console.error('[ROUTER] Error classifying intent:', error);
    // Fallback to simple keyword matching
    const lowerMsg = userMessage.toLowerCase();
    
    if (lowerMsg.match(/pay|payment|transfer|invoice|money|receipt/)) {
      return { agent: 'boss', reasoning: 'Payment keyword detected', confidence: 0.9 };
    }
    
    if (lowerMsg.match(/problem|issue|wrong|broken|not working|help|disappointed|frustrated|complaint/)) {
      return { agent: 'support', reasoning: 'Support keyword detected', confidence: 0.7 };
    }
    
    return { agent: 'sales', reasoning: 'Default routing', confidence: 0.5 };
  }
}

// Send fallback "please hold" message
async function sendFallbackMessage(
  customerPhone: string, 
  company: any, 
  supabase: any, 
  conversationId: string
) {
  const fallbackMsg = "Thank you for your message. I'm looking into that for you - someone will respond shortly. 🙏";
  
  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
  
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const formData = new URLSearchParams();
    formData.append('From', company.whatsapp_number.startsWith('whatsapp:') ? company.whatsapp_number : `whatsapp:${company.whatsapp_number}`);
    formData.append('To', `whatsapp:${customerPhone}`);
    formData.append('Body', fallbackMsg);
    
    await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });
    
    // Log fallback message
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      role: 'assistant',
      content: fallbackMsg
    });
    
    console.log('[FALLBACK] Sent hold message to customer');
  }
}

// Generate 3-bullet conversation summary using AI
async function generateConversationSummary(
  conversationId: string,
  supabase: any
): Promise<string> {
  try {
    // Fetch last 10 messages
    const { data: messages } = await supabase
      .from('messages')
      .select('role, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (!messages || messages.length === 0) {
      return '• No conversation history available';
    }
    
    // Format conversation
    const conversationText = messages
      .reverse()
      .map((m: any) => `${m.role === 'user' ? 'Customer' : 'AI'}: ${m.content}`)
      .join('\n');
    
    // Use DeepSeek to generate summary
    const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY');
    if (!DEEPSEEK_API_KEY) {
      // Fallback: simple summary
      const lastUserMsg = messages.find((m: any) => m.role === 'user')?.content || 'No message';
      return `• Customer's last message: ${lastUserMsg.substring(0, 100)}...`;
    }
    
    const summaryResponse = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: 'You are a business analyst. Create a brief 3-bullet point executive summary of this conversation for a manager. Focus on: 1) What the customer wants, 2) Key details discussed, 3) Why human intervention is needed. Keep each bullet under 20 words.'
          },
          {
            role: 'user',
            content: `Conversation:\n${conversationText}\n\nCreate 3-bullet summary:`
          }
        ],
        temperature: 0.3,
        max_tokens: 200
      })
    });
    
    const summaryData = await summaryResponse.json();
    return summaryData.choices[0]?.message?.content || '• Summary generation failed';
    
  } catch (error) {
    console.error('[SUMMARY] Error generating summary:', error);
    return '• Unable to generate summary';
  }
}

// Send boss handoff notification with formatted message
async function sendBossHandoffNotification(
  company: any,
  customerPhone: string,
  customerName: string,
  summary: string,
  supabase: any,
  handedOffBy: string = 'unknown'
) {
  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
  
  if (!company.boss_phone || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    console.log('[HANDOFF] Cannot send boss notification - missing config');
    return;
  }
  
  // Format phone number for display (remove whatsapp: prefix)
  const displayPhone = customerPhone.replace('whatsapp:', '');
  
  // Check if 24-hour service window is active
  const now = new Date();
  const adminLastActive = company.admin_last_active ? new Date(company.admin_last_active) : null;
  const hoursSinceActive = adminLastActive 
    ? (now.getTime() - adminLastActive.getTime()) / (1000 * 60 * 60)
    : 999;
  
  const windowActive = hoursSinceActive < 24;
  
  if (windowActive) {
    // Send free-form notification (within 24-hour window)
  const agentLabel = handedOffBy === 'support_agent' ? 'Support Agent' : 
                    handedOffBy === 'sales_agent' ? 'Sales Agent' : 
                    handedOffBy === 'supervisor_router' ? 'Supervisor (Payment/Critical)' : 
                    'System';

  const message = `🔔 ACTION REQUIRED

Client Name: ${customerName}
Client Number: ${displayPhone}
Handed off by: ${agentLabel}

Summary:
${summary}

Reply with 'Unmute' to resume AI for this client.`;
    
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const formData = new URLSearchParams();
    
    const fromNumber = company.whatsapp_number.startsWith('whatsapp:') 
      ? company.whatsapp_number 
      : `whatsapp:${company.whatsapp_number}`;
    const toNumber = company.boss_phone.startsWith('whatsapp:')
      ? company.boss_phone
      : `whatsapp:${company.boss_phone}`;
    
    formData.append('From', fromNumber);
    formData.append('To', toNumber);
    formData.append('Body', message);
    
    const response = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });
    
    if (response.ok) {
      console.log('[HANDOFF] Boss notification sent successfully (free-form)');
    } else {
      const errorText = await response.text();
      console.error('[HANDOFF] Failed to send notification:', errorText);
    }
    
  } else {
    // Service window expired
    console.log('[HANDOFF] Service window expired - storing pending notification');
    
    // Store notification for next admin wake-up
    await supabase
      .from('boss_conversations')
      .insert({
        company_id: company.id,
        message_from: 'system',
        message_content: `Pending handoff for ${customerName} (${displayPhone})`,
        response: summary
      });
  }
  
  // Log notification in boss_conversations
  await supabase
    .from('boss_conversations')
    .insert({
      company_id: company.id,
      message_from: 'system',
      message_content: `Handoff notification sent to boss`,
      response: `Client: ${customerName} (${displayPhone})\nSummary: ${summary}`
    });
}

// Background processing function that handles AI response
async function processAIResponse(
  conversationId: string,
  companyId: string,
  userMessage: string,
  storedMediaUrls: string[],
  storedMediaTypes: string[],
  customerPhone: string
) {
  console.log('[BACKGROUND] Starting AI processing for conversation:', conversationId);
  
  // Classify message complexity
  const messageComplexity = classifyMessageComplexity(userMessage);
  console.log(`[BACKGROUND] Message complexity: ${messageComplexity}`);
  
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    // Fetch conversation and company data
    const { data: conversation } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single();

    const { data: company } = await supabase
      .from('companies')
      .select('*, metadata')
      .eq('id', companyId)
      .single();

    if (!conversation || !company) {
      console.error('[BACKGROUND] Failed to fetch conversation or company data');
      return;
    }

    // Check if agent routing is enabled for this company
    const agentRoutingEnabled = company.agent_routing_enabled !== false;
    
    // Fetch conversation history for routing
    const { data: messageHistory } = await supabase
      .from('messages')
      .select('role, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    // ========== DYNAMIC AGENT ROUTING ==========
    let selectedAgent = 'sales';
    let routingReasoning = 'Default routing';
    const previousAgent = conversation.active_agent || 'sales';

    if (agentRoutingEnabled) {
      try {
        console.log('[ROUTER] Classifying intent...');
        console.log(`[ROUTER] Current active agent: ${previousAgent}`);
        console.log(`[ROUTER] Message to classify: "${userMessage.substring(0, 100)}${userMessage.length > 100 ? '...' : ''}"`);
        
        const routingResult = await routeToAgent(userMessage, messageHistory || []);
        selectedAgent = routingResult.agent;
        routingReasoning = routingResult.reasoning;
        
        console.log(`[ROUTER] ✓ Classification complete - Selected agent: ${selectedAgent}, Confidence: ${routingResult.confidence}`);
        
        // ========== DETECT AGENT SWITCH ==========
        const agentSwitched = previousAgent !== selectedAgent;
        
        if (agentSwitched) {
          console.log(`[ROUTER] 🔄 AGENT SWITCH DETECTED: ${previousAgent} → ${selectedAgent}`);
          console.log(`[ROUTER] Switch reason: ${routingReasoning}`);
          
          // Log the agent switch event
          await supabase.from('agent_performance').insert({
            company_id: companyId,
            conversation_id: conversationId,
            agent_type: selectedAgent,
            routing_confidence: routingResult.confidence,
            notes: `Agent switch: ${previousAgent} → ${selectedAgent}. Reason: ${routingReasoning}`
          });
        } else {
          console.log(`[ROUTER] Agent remains: ${selectedAgent}`);
          
          // Log routing decision even if no switch
          await supabase.from('agent_performance').insert({
            company_id: companyId,
            conversation_id: conversationId,
            agent_type: selectedAgent,
            routing_confidence: routingResult.confidence,
            notes: routingReasoning
          });
        }

        // Update conversation with new agent and pause state
        const wasAlreadyPaused = conversation.is_paused_for_human;
        const wasAlreadyHandoff = conversation.human_takeover;
        
        console.log(`[STATE] Before update - Paused: ${wasAlreadyPaused}, Handoff: ${wasAlreadyHandoff}, Agent: ${previousAgent}`);
        
        if (selectedAgent === 'boss') {
          // Boss agent - pause for human takeover
          console.log(`[PAUSE] 🛑 Pausing conversation ${conversationId} for boss/human takeover`);
          
          await supabase.from('conversations').update({ 
            active_agent: 'boss',
            is_paused_for_human: true, 
            human_takeover: true 
          }).eq('id', conversationId);
          
          console.log(`[STATE] After update - Paused: true, Handoff: true, Agent: boss`);
        } else {
          // Support or Sales agent - ensure NOT paused
          if (wasAlreadyPaused) {
            console.log(`[UNPAUSE] ✅ Auto-unpausing conversation ${conversationId} - routed to ${selectedAgent} agent`);
          }
          
          await supabase.from('conversations').update({ 
            active_agent: selectedAgent,
            is_paused_for_human: false,
            human_takeover: false
          }).eq('id', conversationId);
          
          console.log(`[STATE] After update - Paused: false, Handoff: false, Agent: ${selectedAgent}`);
        }

        // Handle BOSS agent - trigger handoff notification
        if (selectedAgent === 'boss') {
          console.log(`[HANDOFF] 📞 Generating handoff notification for boss`);
          const summary = await generateConversationSummary(conversationId, supabase);
          
          const handoffSource = agentSwitched ? `${previousAgent}_agent` : 'supervisor_router';
          console.log(`[HANDOFF] Source: ${handoffSource}, Customer: ${conversation.customer_name || 'Unknown'}`);
          await sendBossHandoffNotification(company, customerPhone, conversation.customer_name || 'Unknown', summary, supabase, handoffSource);
          console.log(`[HANDOFF] ✓ Boss notification sent successfully`);
          
          // Send notification to CLIENT that a representative will reach out
          const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
          const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
          
          if (company.boss_phone && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
            const clientNotificationMessage = `Thank you for your message. A representative will reach out to you shortly on ${company.boss_phone} to assist you further.`;
            
            console.log(`[HANDOFF] 📤 Sending client notification: "${clientNotificationMessage.substring(0, 50)}..."`);
            
            const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
            const fromNumber = company.whatsapp_number.startsWith('whatsapp:') 
              ? company.whatsapp_number 
              : `whatsapp:${company.whatsapp_number}`;
            
            const formData = new URLSearchParams();
            formData.append('From', fromNumber);
            formData.append('To', `whatsapp:${customerPhone}`);
            formData.append('Body', clientNotificationMessage);
            
            const twilioResponse = await fetch(twilioUrl, {
              method: 'POST',
              headers: {
                'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: formData.toString(),
            });
            
            if (twilioResponse.ok) {
              console.log('[HANDOFF] Client notification sent successfully');
              
              // Store client notification message in database
              await supabase.from('messages').insert({
                conversation_id: conversationId,
                role: 'assistant',
                content: clientNotificationMessage
              });
            } else {
              const errorText = await twilioResponse.text();
              console.error('[HANDOFF] Failed to send client notification:', twilioResponse.status, errorText);
            }
          }
          
          // Trigger post-handoff mini-briefing
          try {
            await supabase.functions.invoke('daily-briefing', {
              body: {
                triggerType: 'handoff',
                conversationId: conversationId,
                companyId: company.id
              }
            });
            console.log('[ROUTER] Post-handoff briefing triggered');
          } catch (briefingError) {
            console.error('[ROUTER] Error triggering handoff briefing:', briefingError);
          }
          
          console.log('[ROUTER] Handoff complete');
          return;
        }
      } catch (error) {
        console.error('[ROUTER] Error:', error);
        selectedAgent = previousAgent; // Fallback to previous agent on error
      }
    }

    // Fetch AI overrides and other company data
    const { data: aiOverrides } = await supabase
      .from('company_ai_overrides')
      .select('*')
      .eq('company_id', company.id)
      .maybeSingle();

    const { data: documents } = await supabase
      .from('company_documents')
      .select('*')
      .eq('company_id', company.id)
      .eq('status', 'processed');

    // Fetch media library with specific columns
    const { data: mediaLibrary } = await supabase
      .from('company_media')
      .select('description, category, file_path, media_type, file_type')
      .eq('company_id', company.id);

    // Construct full URLs for media
    const mediaWithUrls = mediaLibrary?.map(media => ({
      ...media,
      full_url: `https://dzheddvoiauevcayifev.supabase.co/storage/v1/object/public/company-media/${media.file_path}`
    })) || [];

    // ========== AGENT-SPECIFIC SYSTEM PROMPTS ==========
    let agentPersonality = '';
    
    if (selectedAgent === 'support') {
      agentPersonality = `

🛠️ YOU ARE THE SUPPORT AGENT:
- Your role is to EMPATHIZE and RESOLVE customer issues
- Listen carefully to complaints and acknowledge their frustration
- Apologize sincerely when appropriate
- Provide clear step-by-step solutions
- Be patient, helpful, and understanding
- Focus on making things right for the customer
- If you cannot resolve the issue, escalate by using [HANDOFF_REQUIRED]`;
    } else if (selectedAgent === 'sales') {
      agentPersonality = `

💼 YOU ARE THE SALES AGENT:
- Your role is to CONVERT and CLOSE sales
- Highlight product benefits and value propositions
- Create urgency and excitement
- Ask qualifying questions to understand needs
- Offer personalized recommendations
- Be persuasive but not pushy
- Guide customers toward making a purchase decision
- Address pricing objections with value-focused responses`;
    }

    // Build AI instructions
    let instructions = `You are a friendly AI assistant for ${company.name}`;
    
    if (company.industry) {
      instructions += ` (${company.industry})`;
    }
    
    instructions += `.${agentPersonality}

Business Information:
- Business Name: ${company.name}
- Phone: ${company.phone}
- Address: ${company.address || 'Not specified'}
${company.business_hours ? `- Hours: ${company.business_hours}` : ''}
${company.services ? `- Services: ${company.services}` : ''}
${company.currency_prefix ? `- Currency: ${company.currency_prefix}` : ''}
${company.email ? `- Email: ${company.email}` : ''}`;

    // Add quick reference knowledge base
    if (company.quick_reference_info && company.quick_reference_info.trim()) {
      instructions += `\n\n=== QUICK REFERENCE KNOWLEDGE BASE ===\n${company.quick_reference_info}`;
    }

    // Add AI overrides if present
    if (aiOverrides) {
      if (aiOverrides.system_instructions) {
        instructions += `\n\n=== CUSTOM SYSTEM INSTRUCTIONS ===\n${aiOverrides.system_instructions}`;
      }
      if (aiOverrides.qa_style) {
        instructions += `\n\n=== Q&A STYLE ===\n${aiOverrides.qa_style}`;
      }
      if (aiOverrides.banned_topics) {
        instructions += `\n\n=== BANNED TOPICS ===\n${aiOverrides.banned_topics}`;
      }
    }

    // Add knowledge base
    if (documents && documents.length > 0) {
      instructions += '\n\n=== KNOWLEDGE BASE ===\n';
      for (const doc of documents) {
        instructions += `\nDocument: ${doc.filename}\n${doc.parsed_content}\n`;
      }
    }

    // Add media library
    if (mediaWithUrls && mediaWithUrls.length > 0) {
      instructions += '\n\n=== MEDIA LIBRARY ===\n';
      instructions += 'Available media files:\n';
      for (const media of mediaWithUrls) {
        const displayName = media.description || media.category;
        instructions += `- ${displayName} (${media.category}, ${media.media_type}): ${media.full_url}\n`;
      }
      instructions += '\n⚠️ CRITICAL RULES FOR MEDIA:\n';
      instructions += '1. ONLY use URLs from the list above - NEVER make up or guess URLs\n';
      instructions += '2. If customer asks for more samples than available, tell them you have ' + mediaWithUrls.length + ' samples and offer to send what you have\n';
      instructions += '3. When sending media, call send_media with ONLY the exact URLs listed above\n';
      instructions += '4. DO NOT create fake URLs like "https://omanut.tech/media/..." or "https://example.com/..."\n';
      instructions += '5. If no relevant media exists, tell the customer and offer alternatives\n';
    } else {
      instructions += '\n\n⚠️ NO MEDIA LIBRARY: You have no media files to share. If customer asks for samples, apologize and explain you can create custom designs for them.\n';
    }

    instructions += `\n\nKey Guidelines:
1. Be warm, friendly, and professional
2. Answer questions about our business using the information above
3. CALENDAR AVAILABILITY - CRITICAL:
   - ALWAYS check_calendar_availability BEFORE sending reservation flow
   - If time slot is busy, suggest alternative available times
   - Never confirm reservations without checking calendar first
   - CALENDAR UNAVAILABLE PROTOCOL: If calendar check fails/errors:
     * DO NOT keep asking for date/time if customer already provided it
     * Proceed with reservation collection anyway using send_flow tool
     * Inform customer that team will confirm availability shortly
     * Never create conversation loops by repeating the same question
4. For reservations, use send_flow tool IMMEDIATELY after confirming availability OR if calendar is unavailable
5. For payments, use send_flow tool IMMEDIATELY - DO NOT ask questions one-by-one
6. When customers ask for samples/photos/videos, IMMEDIATELY use send_media tool
7. KEEP RESPONSES SHORT AND CONCISE:
   - Simple questions (greetings, yes/no, basic info): 1-3 sentences maximum
   - Only provide detailed explanations when customer explicitly asks or for complex topics
   - Use bullet points for lists instead of long paragraphs
   - Get straight to the point
8. If you don't know something, admit it politely
9. Never make up information not provided above
10. CRITICAL: When sending media, do NOT say you'll send it - just call send_media immediately
11. Use natural Zambian phrasing and Kwacha prices using ${company.currency_prefix}.

CRITICAL HANDOFF PROTOCOL:
- If the customer AGREES TO PAYMENT or expresses clear intent to pay, append [HANDOFF_REQUIRED] at the very end of your response
- If you encounter a COMPLEX QUESTION you cannot solve confidently, append [HANDOFF_REQUIRED] at the very end
- Examples requiring handoff:
  * "Yes, I'd like to pay now"
  * "How can I make the payment?"
  * "I have a technical issue with..."
  * Questions about custom requests, refunds, complaints requiring human judgment
- IMPORTANT: The customer will NOT see the [HANDOFF_REQUIRED] tag - it's for internal system use only
- Continue to provide a helpful response to the customer, then add the tag`;


    // Build conversation history
    const transcriptLines = conversation.transcript.split('\n').filter((line: string) => line.trim());
    const recentHistory = transcriptLines.slice(-20).join('\n');

    const messages = [
      { role: 'system', content: instructions }
    ];

    if (recentHistory.trim()) {
      messages.push({ role: 'user', content: `Previous conversation:\n${recentHistory}` });
    }

    messages.push({ role: 'user', content: userMessage });

    // ========== SUPERVISOR AGENT LAYER ==========
    // Call supervisor ONLY for complex queries
    let supervisorRecommendation = null;
    
    if (messageComplexity === 'complex') {
      console.log('[SUPERVISOR] Requesting strategic analysis for complex query...');
      
      try {
        const supervisorResponse = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/supervisor-agent`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              companyId: company.id,
              customerPhone,
              customerMessage: userMessage,
              conversationHistory: transcriptLines.slice(-20),
              companyData: company,
              customerData: conversation
            })
          }
        );

        if (supervisorResponse.ok) {
          const supervisorData = await supervisorResponse.json();
          if (supervisorData.success) {
            supervisorRecommendation = supervisorData.recommendation;
            console.log('[SUPERVISOR] Strategic guidance received');
            console.log('[SUPERVISOR] Strategy:', supervisorRecommendation.strategy);
          }
        } else {
          console.log('[SUPERVISOR] Supervisor unavailable, proceeding without guidance');
        }
      } catch (error) {
        console.error('[SUPERVISOR] Supervisor failed, proceeding without guidance:', error);
      }
    } else {
      console.log('[SUPERVISOR] Skipping supervisor for simple query - responding quickly');
    }

    // Enhance instructions with supervisor guidance if available
    if (supervisorRecommendation) {
      instructions += `\n\n=== STRATEGIC SUPERVISOR GUIDANCE ===
Your supervisor has analyzed this interaction and provided strategic recommendations:

ANALYSIS: ${supervisorRecommendation.analysis}

RECOMMENDED STRATEGY: ${supervisorRecommendation.strategy}

KEY POINTS TO ADDRESS:
${supervisorRecommendation.keyPoints.map((point: string, i: number) => `${i + 1}. ${point}`).join('\n')}

TONE GUIDANCE: ${supervisorRecommendation.toneGuidance}

CONVERSION TIPS:
${supervisorRecommendation.conversionTips.map((tip: string, i: number) => `${i + 1}. ${tip}`).join('\n')}

AVOID:
${supervisorRecommendation.avoidances.map((avoid: string, i: number) => `${i + 1}. ${avoid}`).join('\n')}

RECOMMENDED APPROACH:
${supervisorRecommendation.recommendedResponse}

⚠️ CRITICAL: Use this strategic guidance to craft your response. The customer should only see your final response - never mention the supervisor or internal analysis.`;
      
      // Update messages array with enhanced instructions
      messages[0] = { role: 'system', content: instructions };
    }
    // Update system message with supervisor guidance
    messages[0] = { role: 'system', content: instructions };

    // Select Gemini model based on complexity
    const selectedModel = messageComplexity === 'simple' ? 'google/gemini-2.5-flash' : 'google/gemini-3-pro-preview';
    const maxTokens = messageComplexity === 'simple' ? 2048 : 8192;
    console.log(`[AI] Using model: ${selectedModel} with max_tokens: ${maxTokens}`);

    // Call Lovable AI Gateway with extended timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    
    let assistantReply = '';
    let anyToolExecuted = false;
    let toolExecutionContext: string[] = [];

    try {
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: selectedModel,
          messages,
          temperature: 1.0,
          max_tokens: maxTokens,
          tools: [
            {
              type: "function",
              function: {
                name: "send_flow",
                description: "Send a WhatsApp Flow form to collect information from the customer. Use this INSTEAD of asking multiple questions. Available for reservations and payment information.",
                parameters: {
                  type: "object",
                  properties: {
                    flow_type: {
                      type: "string",
                      enum: ["reservation", "payment"],
                      description: "Type of flow to send"
                    },
                    header_text: {
                      type: "string",
                      description: "Header text for the flow message (e.g., 'Complete Your Reservation')"
                    },
                    button_text: {
                      type: "string",
                      description: "Button text (e.g., 'Fill Form')"
                    },
                    prefill_data: {
                      type: "object",
                      description: "Optional pre-filled data from conversation context",
                      properties: {
                        customer_name: { type: "string" },
                        phone: { type: "string" },
                        email: { type: "string" }
                      }
                    }
                  },
                  required: ["flow_type", "header_text", "button_text"]
                }
              }
            },
            {
              type: "function",
              function: {
                name: "create_reservation",
                description: "DEPRECATED: Use send_flow instead. Only use if flow fails.",
                parameters: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "Customer's full name" },
                    phone: { type: "string", description: "Customer's phone number" },
                    date: { type: "string", description: "Date in YYYY-MM-DD format" },
                    time: { type: "string", description: "Time in HH:MM 24-hour format" },
                    guests: { type: "number", description: "Number of guests" },
                    occasion: { type: "string", description: "Occasion or reason for booking" },
                    area_preference: { type: "string", description: "Seating preference" },
                    branch: { type: "string", description: "Branch or location" },
                    email: { type: "string", description: "Email address (optional)" }
                  },
                  required: ["name", "phone", "date", "time", "guests", "area_preference", "branch"]
                }
              }
            },
            {
              type: "function",
              function: {
                name: "send_media",
                description: "Send media files to customer via WhatsApp. Use when customer asks for samples, photos, videos, or examples.",
                parameters: {
                  type: "object",
                  properties: {
                    media_urls: {
                      type: "array",
                      items: { type: "string" },
                      description: "Array of media file URLs from the library"
                    },
                    caption: {
                      type: "string",
                      description: "Caption for the media"
                    },
                    category: {
                      type: "string",
                      description: "Category of media (menu, interior, exterior, logo, products, etc.)"
                    }
                  },
                  required: ["media_urls", "category"]
                }
              }
            },
            {
              type: "function",
              function: {
                name: "check_calendar_availability",
                description: "Check if a date/time slot is available before confirming reservation. ALWAYS use this BEFORE sending reservation flow.",
                parameters: {
                  type: "object",
                  properties: {
                    date: { type: "string", description: "Date in YYYY-MM-DD format" },
                    time: { type: "string", description: "Time in HH:MM format" },
                    duration_minutes: { type: "number", description: "Expected duration in minutes (default 120)" }
                  },
                  required: ["date", "time"]
                }
              }
            },
            {
              type: "function",
              function: {
                name: "create_calendar_event",
                description: "Create Google Calendar event for confirmed reservation. Use after customer confirms booking.",
                parameters: {
                  type: "object",
                  properties: {
                    reservation_id: { type: "string", description: "Reservation UUID from database" },
                    title: { type: "string", description: "Event title (e.g., 'Reservation: John Doe - 4 guests')" },
                    description: { type: "string", description: "Event notes (customer details, preferences)" },
                    send_notifications: { type: "boolean", description: "Send email notifications (default true)" }
                  },
                  required: ["reservation_id", "title"]
                }
              }
            },
            {
              type: "function",
              function: {
                name: "request_payment",
                description: "Request payment from customer and notify management",
                parameters: {
                  type: "object",
                  properties: {
                    product_id: { type: "string" },
                    product_name: { type: "string" },
                    amount: { type: "number" },
                    payment_method: { type: "string" },
                    customer_details: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        email: { type: "string" }
                      }
                    }
                  },
                  required: ["product_id", "product_name", "amount", "payment_method"]
                }
              }
            }
          ],
          tool_choice: "auto"
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[BACKGROUND] Kimi AI error:', response.status, errorText);
        throw new Error(`Kimi AI error: ${response.status}`);
      }

      const aiData = await response.json();
      assistantReply = aiData.choices[0].message.content || '';
      const toolCalls = aiData.choices[0].message.tool_calls;

      console.log('[BACKGROUND] AI response:', { assistantReply, toolCalls });

      // Handle tool calls
      if (toolCalls && toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          if (toolCall.function.name === 'request_payment') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('[BACKGROUND] Processing payment request:', args);
            
            try {
              await supabase.functions.invoke('send-boss-notification', {
                body: {
                  companyId: company.id,
                  notificationType: 'payment_request',
                  data: {
                    customer_name: conversation.customer_name || args.customer_details?.name || 'Unknown',
                    customer_phone: `whatsapp:${customerPhone}`,
                    customer_email: args.customer_details?.email,
                    product_name: args.product_name,
                    amount: args.amount,
                    currency_prefix: company.currency_prefix,
                    payment_method: args.payment_method
                  }
                }
              });
              
              anyToolExecuted = true;
              toolExecutionContext.push(`notified management about payment request for ${args.product_name}`);
              assistantReply = `Thank you for your interest in *${args.product_name}*! Our team has been notified and will contact you shortly with payment instructions. 📱`;
            } catch (error) {
              console.error('[BACKGROUND] Payment request error:', error);
              assistantReply += "\n\nI encountered an error processing your payment request. Please try again.";
            }
          } else if (toolCall.function.name === 'send_media') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('[BACKGROUND] send_media called with:', JSON.stringify(args));
            
            // Validate all URLs are from allowed sources
            const allowedDomains = ['supabase.co'];
            const invalidUrls = args.media_urls.filter((url: string) => {
              try {
                const urlObj = new URL(url);
                return !allowedDomains.some(domain => urlObj.hostname.includes(domain));
              } catch {
                return true; // Invalid URL format
              }
            });
            
            if (invalidUrls.length > 0) {
              console.error('[BACKGROUND] Rejected invalid/fake URLs:', invalidUrls);
              anyToolExecuted = true;
              assistantReply = "Sorry, I can only share media from our official library. Let me know what type of samples you'd like to see.";
              break;
            }
            
            const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
            const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
            
            if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
              try {
                const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
                const fromNumber = company.whatsapp_number.startsWith('whatsapp:') 
                  ? company.whatsapp_number 
                  : `whatsapp:${company.whatsapp_number}`;

                // Generate signed URLs for media
                console.log('[BACKGROUND] Processing media URLs:', args.media_urls);
                const signedMediaUrls: string[] = [];
                for (const mediaUrl of args.media_urls) {
                  console.log(`[BACKGROUND] Processing media URL: ${mediaUrl}`);
                  
                  if (mediaUrl.includes('/company-media/')) {
                    // Supabase storage URL - create signed URL
                    const urlParts = mediaUrl.split('/company-media/');
                    if (urlParts.length === 2) {
                      const filePath = urlParts[1];
                      console.log(`[BACKGROUND] Creating signed URL for file path: ${filePath}`);
                      const { data: signedData } = await supabase.storage
                        .from('company-media')
                        .createSignedUrl(filePath, 3600);
                      
                      if (signedData?.signedUrl) {
                        signedMediaUrls.push(signedData.signedUrl);
                        console.log(`[BACKGROUND] Created signed URL successfully`);
                      } else {
                        console.error(`[BACKGROUND] Failed to create signed URL for: ${filePath}`);
                      }
                    }
                  } else {
                    // External URL - use directly
                    signedMediaUrls.push(mediaUrl);
                    console.log(`[BACKGROUND] Using external URL directly`);
                  }
                }
                
                console.log(`[BACKGROUND] Total media URLs to send: ${signedMediaUrls.length}`);

                if (signedMediaUrls.length > 0) {
                  let successCount = 0;
                  
                  for (let i = 0; i < signedMediaUrls.length; i++) {
                    const mediaUrl = signedMediaUrls[i];
                    console.log(`[BACKGROUND] Sending media ${i+1}/${signedMediaUrls.length}: ${mediaUrl}`);
                    
                    const formData = new URLSearchParams();
                    formData.append('From', fromNumber);
                    formData.append('To', `whatsapp:${customerPhone}`);
                    formData.append('Body', i === 0 && args.caption ? args.caption : '');
                    formData.append('MediaUrl', mediaUrl);

                    const twilioResponse = await fetch(twilioUrl, {
                      method: 'POST',
                      headers: {
                        'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
                        'Content-Type': 'application/x-www-form-urlencoded',
                      },
                      body: formData.toString(),
                    });

                    if (twilioResponse.ok) {
                      successCount++;
                      console.log(`[BACKGROUND] Media ${i+1} sent successfully`);
                    } else {
                      const errorText = await twilioResponse.text();
                      console.error(`[BACKGROUND] Failed to send media ${i+1}:`, twilioResponse.status, errorText);
                    }
                  }

                  await supabase
                    .from('messages')
                    .insert({
                      conversation_id: conversationId,
                      role: 'assistant',
                      content: `[Sent ${signedMediaUrls.length} ${args.category} media file(s)]${args.caption ? ' - ' + args.caption : ''}`
                    });

                  if (successCount === signedMediaUrls.length) {
                    anyToolExecuted = true;
                    toolExecutionContext.push(`sent ${signedMediaUrls.length} ${args.category} media file(s)`);
                    console.log('[BACKGROUND] All media sent successfully');
                  }
                }
              } catch (error) {
                console.error('[BACKGROUND] Media send error:', error);
                assistantReply = "I tried to send the media but encountered an error.";
              }
            }
          } else if (toolCall.function.name === 'check_calendar_availability') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('[BACKGROUND] Checking calendar availability:', args);
            
            try {
              const { data: calendarData, error: calError } = await supabase.functions.invoke('google-calendar', {
                body: {
                  action: 'check_availability',
                  companyId: company.id,
                  date: args.date,
                  time: args.time,
                  duration: args.duration_minutes || 120
                }
              });
              
              if (calError) {
                console.error('[BACKGROUND] Calendar check error:', calError);
                toolExecutionContext.push('calendar unavailable - proceeding without availability check');
                
                // Context-aware error handling: Check if customer already provided date/time
                const hasDateTime = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|tonight|weekend|\d{1,2}:\d{2}|am|pm|morning|afternoon|evening|noon|midnight)\b/i.test(userMessage);
                
                if (hasDateTime) {
                  // Customer already mentioned time - proceed with reservation flow
                  assistantReply = "Perfect! Let me collect your reservation details. While our calendar system is updating, " +
                    "our team will confirm availability and get back to you shortly.";
                  toolExecutionContext.push('customer provided date/time - proceed with reservation flow despite calendar error');
                } else {
                  // Customer didn't mention time yet - ask for it once
                  assistantReply = "I'd be happy to help you schedule a visit! While our calendar system is updating, " +
                    "let me record your details and our team will confirm availability shortly. " +
                    "What date and time works best for you?";
                }
                anyToolExecuted = true;
              } else {
                anyToolExecuted = true;
                if (calendarData.available) {
                  toolExecutionContext.push(`Time slot ${args.date} ${args.time} is AVAILABLE`);
                } else {
                  toolExecutionContext.push(`Time slot ${args.date} ${args.time} is BUSY: ${calendarData.message}`);
                  assistantReply = `I checked our calendar and ${args.time} on ${args.date} is already booked. ` +
                    `Would you like to try a different time? I can check other available slots for you.`;
                }
              }
            } catch (error) {
              console.error('[BACKGROUND] Calendar availability error:', error);
              toolExecutionContext.push('calendar check failed - proceeding without availability');
            }
          } else if (toolCall.function.name === 'create_calendar_event') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('[BACKGROUND] Creating calendar event:', args);
            
            try {
              const { data: eventData, error: eventError } = await supabase.functions.invoke('google-calendar', {
                body: {
                  action: 'create_event',
                  companyId: company.id,
                  reservationId: args.reservation_id,
                  title: args.title,
                  description: args.description || '',
                  sendNotifications: args.send_notifications !== false
                }
              });
              
              if (eventError) {
                console.error('[BACKGROUND] Calendar event creation error:', eventError);
                toolExecutionContext.push('calendar event creation failed - reservation saved but not synced to calendar');
              } else {
                anyToolExecuted = true;
                toolExecutionContext.push(`calendar event created: ${eventData.event_id}`);
                assistantReply += `\n\n📅 Added to calendar: ${eventData.link}`;
              }
            } catch (error) {
              console.error('[BACKGROUND] Calendar event error:', error);
              toolExecutionContext.push('calendar event failed - reservation saved but not in calendar');
            }
          } else if (toolCall.function.name === 'send_flow') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('[BACKGROUND] send_flow called with:', JSON.stringify(args));
            
            try {
              // Call send-whatsapp-flow edge function
              const flowResponse = await supabase.functions.invoke('send-whatsapp-flow', {
                body: {
                  flow_type: args.flow_type,
                  header_text: args.header_text,
                  button_text: args.button_text,
                  prefill_data: args.prefill_data || {},
                  customer_phone: customerPhone,
                  company_id: company.id
                }
              });
              
              if (flowResponse.error || flowResponse.data?.error) {
                console.error('[BACKGROUND] Flow send error:', flowResponse.error || flowResponse.data?.error);
                toolExecutionContext.push('whatsapp flow unavailable - falling back to manual details');
                assistantReply = args.flow_type === 'reservation'
                  ? "Our quick reservation form isn't available right now. Please send your name, preferred date, time, and number of guests in one message, and I'll record it for the team."
                  : "Our quick payment form isn't available right now. Please send your name, phone, email, and what you're paying for in one message.";
              } else {
                console.log('[BACKGROUND] Flow sent successfully');
                assistantReply = `I've sent you a quick form to complete. Please fill it out and submit. 📋`;
              }
            } catch (error) {
              console.error('[BACKGROUND] send_flow error:', error);
              toolExecutionContext.push('whatsapp flow error - falling back to manual details');
              assistantReply = args.flow_type === 'reservation'
                ? "Our quick reservation form isn't available right now. Please send your name, preferred date, time, and number of guests in one message, and I'll record it for the team."
                : "Our quick payment form isn't available right now. Please send your name, phone, email, and what you're paying for in one message.";
            }
          } else if (toolCall.function.name === 'create_reservation') {
            const args = JSON.parse(toolCall.function.arguments);
            const reservationPhone = args.phone || customerPhone;
            
            const { error: resError } = await supabase
              .from('reservations')
              .insert({
                company_id: company.id,
                conversation_id: conversationId,
                name: args.name,
                phone: reservationPhone,
                email: args.email || null,
                date: args.date,
                time: args.time,
                guests: args.guests,
                occasion: args.occasion || null,
                area_preference: args.area_preference,
                branch: args.branch,
                status: 'confirmed'
              });

            if (resError) {
              console.error('[BACKGROUND] Reservation error:', resError);
              assistantReply += "\n\nI encountered an error saving your reservation. Please contact us directly.";
            } else {
              anyToolExecuted = true;
              toolExecutionContext.push(`created reservation for ${args.name}`);
              
              await supabase
                .from('conversations')
                .update({ customer_name: args.name })
                .eq('id', conversationId);
                
              assistantReply += "\n\nYour reservation has been confirmed! We look forward to serving you.";
              
              if (args.email) {
                await supabase.functions.invoke('send-reservation-confirmation', {
                  body: {
                    name: args.name,
                    email: args.email,
                    date: args.date,
                    time: args.time,
                    guests: args.guests,
                    restaurantName: company.name
                  }
                });
              }
            }
          }
        }
      }

      clearTimeout(timeoutId);
    } catch (error) {
      clearTimeout(timeoutId);
      console.error('[BACKGROUND] AI processing error:', error);
      assistantReply = `I apologize, but I'm experiencing some technical difficulties. Please try again in a moment. If this persists, contact us at ${company.phone || 'our main number'}.`;
    }

    // Generate contextual message if tools were executed but no reply
    if (anyToolExecuted && (!assistantReply || assistantReply.trim() === '')) {
      assistantReply = "Done! Let me know if you need anything else.";
    }

    // Ensure we have a response
    if (!assistantReply || assistantReply.trim() === '') {
      assistantReply = "Thank you for your message. How can I help you today?";
    }

    // Check for [HANDOFF_REQUIRED] tag
    const handoffRequired = assistantReply.includes('[HANDOFF_REQUIRED]');

    if (handoffRequired) {
      console.log('[HANDOFF] Detected [HANDOFF_REQUIRED] tag - initiating handoff sequence');
      
      // Step 1: Remove tag from customer-facing message
      assistantReply = assistantReply.replace(/\[HANDOFF_REQUIRED\]/g, '').trim();
      
      // Step 2: Mute AI for this client
      await supabase
        .from('conversations')
        .update({ 
          is_paused_for_human: true,
          human_takeover: true,
          takeover_at: new Date().toISOString()
        })
        .eq('id', conversationId);
      
      console.log('[HANDOFF] Conversation muted for AI, marked for human takeover');
      
      // Step 3: Generate 3-bullet summary
      const conversationSummary = await generateConversationSummary(conversationId, supabase);
      
      // Step 4: Determine which agent triggered handoff
      const handoffAgent = selectedAgent === 'support' ? 'support_agent' : 'sales_agent';
      
      // Step 5: Notify Boss with agent information
      await sendBossHandoffNotification(
        company,
        customerPhone,
        conversation.customer_name || 'Unknown',
        conversationSummary,
        supabase,
        handoffAgent
      );
      
      // Trigger post-handoff mini-briefing
      try {
        await supabase.functions.invoke('daily-briefing', {
          body: {
            triggerType: 'handoff',
            conversationId: conversationId,
            companyId: company.id
          }
        });
        console.log('[HANDOFF] Post-handoff briefing triggered');
      } catch (briefingError) {
        console.error('[HANDOFF] Error triggering handoff briefing:', briefingError);
      }
      
      // Step 6: Log handoff to agent_performance
      await supabase
        .from('agent_performance')
        .insert({
          company_id: companyId,
          conversation_id: conversationId,
          agent_type: selectedAgent,
          handoff_occurred: true,
          handoff_reason: 'Agent detected need for human intervention via [HANDOFF_REQUIRED]',
          notes: `${selectedAgent} agent escalated to boss`
        });
      
      console.log(`[HANDOFF] Boss notified - handoff triggered by ${selectedAgent} agent`);
    }

    console.log('[BACKGROUND] Final reply:', assistantReply);

    // Insert assistant message
    await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: assistantReply
      });

    // Update conversation transcript
    const updatedTranscript = `${conversation.transcript}\nCustomer: ${userMessage}\nAssistant: ${assistantReply}\n`;
    await supabase
      .from('conversations')
      .update({ transcript: updatedTranscript })
      .eq('id', conversationId);

    // Send response via Twilio API
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');

    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
      const fromNumber = company.whatsapp_number.startsWith('whatsapp:') 
        ? company.whatsapp_number 
        : `whatsapp:${company.whatsapp_number}`;

      const formData = new URLSearchParams();
      formData.append('From', fromNumber);
      formData.append('To', `whatsapp:${customerPhone}`);
      formData.append('Body', assistantReply);

      const twilioResponse = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      if (twilioResponse.ok) {
        console.log('[BACKGROUND] Response sent successfully via Twilio');
      } else {
        const errorText = await twilioResponse.text();
        console.error('[BACKGROUND] Twilio send error:', twilioResponse.status, errorText);
      }
    }

  } catch (error) {
    console.error('[BACKGROUND] Error processing AI response:', error);
    
    // Send error fallback message to customer
    try {
      const { data: company } = await supabase
        .from('companies')
        .select('whatsapp_number, boss_phone')
        .eq('id', companyId)
        .single();
      
      if (company) {
        const errorFallback = "I'm experiencing technical difficulties right now. Please hold while I connect you with someone who can help.";
        
        const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
        const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
        
        if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
          const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
          const formData = new URLSearchParams();
          formData.append('From', company.whatsapp_number.startsWith('whatsapp:') ? company.whatsapp_number : `whatsapp:${company.whatsapp_number}`);
          formData.append('To', `whatsapp:${customerPhone}`);
          formData.append('Body', errorFallback);
          
          await fetch(twilioUrl, {
            method: 'POST',
            headers: {
              'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData.toString(),
          });
          
          await supabase.from('messages').insert({
            conversation_id: conversationId,
            role: 'assistant',
            content: errorFallback
          });
          
          console.log('[ERROR] Sent error fallback message to customer');
        }
        
        // Mark conversation for human takeover
        await supabase
          .from('conversations')
          .update({ 
            human_takeover: true,
            takeover_at: new Date().toISOString()
          })
          .eq('id', conversationId);
        
        console.log('[ERROR] Marked conversation for human takeover');
        
        // Notify management via boss number if available
        if (company.boss_phone && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
          const bossNotification = `⚠️ AI Error Alert\n\nCustomer: ${customerPhone}\nConversation ID: ${conversationId}\n\nThe AI encountered an error and the conversation has been marked for human takeover. Please check the conversation.`;
          
          const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
          const formData = new URLSearchParams();
          formData.append('From', company.whatsapp_number.startsWith('whatsapp:') ? company.whatsapp_number : `whatsapp:${company.whatsapp_number}`);
          formData.append('To', company.boss_phone.startsWith('whatsapp:') ? company.boss_phone : `whatsapp:${company.boss_phone}`);
          formData.append('Body', bossNotification);
          
          await fetch(twilioUrl, {
            method: 'POST',
            headers: {
              'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData.toString(),
          });
          
          console.log('[ERROR] Notified management about AI error');
        }
      }
    } catch (fallbackError) {
      console.error('[ERROR] Failed to send error fallback:', fallbackError);
    }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Parse Twilio WhatsApp webhook payload
    const formData = await req.formData();
    const From = formData.get('From') as string;
    const To = formData.get('To') as string;
    const Body = formData.get('Body') as string || '';
    
    // Extract media information
    const NumMedia = parseInt(formData.get('NumMedia') as string || '0');
    const mediaFiles: Array<{ url: string; contentType: string }> = [];
    
    for (let i = 0; i < NumMedia; i++) {
      const mediaUrl = formData.get(`MediaUrl${i}`) as string;
      const mediaContentType = formData.get(`MediaContentType${i}`) as string;
      if (mediaUrl && mediaContentType) {
        mediaFiles.push({ url: mediaUrl, contentType: mediaContentType });
      }
    }

    // Validate input
    const messageSchema = z.object({
      From: z.string().min(1).max(255),
      To: z.string().min(1).max(255),
      Body: z.string().max(4096)
    });

    try {
      messageSchema.parse({ From, To, Body });
    } catch (error) {
      console.error('Invalid input:', error);
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[Invalid message format.]]></Message>
</Response>`, {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
      });
    }

    console.log('WhatsApp message received:', { From, To, Body });

    // Look up company by WhatsApp number
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('*, metadata')
      .eq('whatsapp_number', To)
      .maybeSingle();

    if (companyError) {
      console.error('Database error:', companyError);
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[Our service is temporarily unavailable. Please try again later.]]></Message>
</Response>`, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
      });
    }

    if (!company) {
      console.error('Company not found for:', To);
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[This WhatsApp number is not configured. Please contact support.]]></Message>
</Response>`, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
      });
    }

    // Detect WhatsApp Flow Response
    if (Body.includes('__flow_response__')) {
      console.log('[FLOW-RESPONSE] Detected flow submission');
      
      try {
        // Parse the flow response data
        const flowData = JSON.parse(Body.replace('__flow_response__', ''));
        const flowType = flowData.flow_type;
        
        console.log('[FLOW-RESPONSE] Flow data:', JSON.stringify(flowData));
        
        // Find or create conversation
        const customerPhone = From;
        let conversationId: string;
        
        const { data: existingConv } = await supabase
          .from('conversations')
          .select('id')
          .eq('phone', customerPhone)
          .eq('company_id', company.id)
          .eq('status', 'active')
          .maybeSingle();
        
        if (existingConv) {
          conversationId = existingConv.id;
        } else {
          const { data: newConv } = await supabase
            .from('conversations')
            .insert({
              phone: customerPhone,
              company_id: company.id,
              customer_name: flowData.customer_name || 'Customer',
              status: 'active'
            })
            .select('id')
            .single();
          conversationId = newConv!.id;
        }
        
        if (flowType === 'reservation') {
          // Create reservation from flow data
          const { error: resError } = await supabase
            .from('reservations')
            .insert({
              conversation_id: conversationId,
              company_id: company.id,
              name: flowData.customer_name,
              phone: flowData.phone,
              email: flowData.email || null,
              date: flowData.date,
              time: flowData.time,
              guests: parseInt(flowData.guests),
              occasion: flowData.occasion || null,
              area_preference: flowData.area_preference || null,
              branch: flowData.branch || null,
              status: 'confirmed'
            });
          
          if (resError) {
            console.error('[FLOW-RESPONSE] Reservation creation error:', resError);
            return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[Sorry, there was an error processing your reservation. Please try again.]]></Message>
</Response>`, {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' }
            });
          }
          
          // Send confirmation
          const confirmMsg = `🎉 *Reservation Confirmed!*\n\n✅ Name: ${flowData.customer_name}\n📅 Date: ${flowData.date}\n🕐 Time: ${flowData.time}\n👥 Guests: ${flowData.guests}\n\nWe look forward to seeing you!`;
          
          return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[${confirmMsg}]]></Message>
</Response>`, {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' }
          });
          
        } else if (flowType === 'payment') {
          // Create payment transaction from flow data
          const { error: payError } = await supabase
            .from('payment_transactions')
            .insert({
              company_id: company.id,
              conversation_id: conversationId,
              customer_name: flowData.customer_name,
              customer_phone: flowData.phone,
              amount: parseFloat(flowData.amount || '0'),
              currency: company.currency_prefix || 'ZMW',
              payment_method: flowData.payment_method,
              payment_status: 'pending'
            });
          
          if (payError) {
            console.error('[FLOW-RESPONSE] Payment creation error:', payError);
            return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[Sorry, there was an error processing your payment. Please try again.]]></Message>
</Response>`, {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' }
            });
          }
          
          // Notify boss
          if (company.boss_phone) {
            const bossMsg = `💰 *Payment Request*\n\nCustomer: ${flowData.customer_name}\nPhone: ${flowData.phone}\nEmail: ${flowData.email || 'Not provided'}\nMethod: ${flowData.payment_method}\nAmount: ${company.currency_prefix}${flowData.amount || 'TBD'}`;
            
            const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
            const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
            
            const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
            const notifFormData = new URLSearchParams();
            notifFormData.append('From', company.whatsapp_number.startsWith('whatsapp:') ? company.whatsapp_number : `whatsapp:${company.whatsapp_number}`);
            notifFormData.append('To', company.boss_phone.startsWith('whatsapp:') ? company.boss_phone : `whatsapp:${company.boss_phone}`);
            notifFormData.append('Body', bossMsg);
            
            await fetch(twilioUrl, {
              method: 'POST',
              headers: {
                'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: notifFormData.toString(),
            });
          }
          
          // Send confirmation to customer
          const confirmMsg = `✅ *Payment Information Received*\n\nThank you ${flowData.customer_name}! Our team will contact you shortly with payment instructions.`;
          
          return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[${confirmMsg}]]></Message>
</Response>`, {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' }
          });
        }
        
      } catch (error) {
        console.error('[FLOW-RESPONSE] Error processing flow:', error);
        return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[Sorry, there was an error processing your form. Please try again.]]></Message>
</Response>`, {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' }
        });
      }
    }

    // Check if message is from boss or takeover number
    const normalizePhone = (phone: string) => {
      return phone.replace(/^whatsapp:/i, '').replace(/\+/g, '').replace(/\s/g, '');
    };
    
    const fromPhone = normalizePhone(From);
    const bossPhone = company.boss_phone ? normalizePhone(company.boss_phone) : '';
    const takeoverPhone = company.takeover_number ? normalizePhone(company.takeover_number) : '';
    
    console.log('Phone comparison:', { fromPhone, bossPhone, takeoverPhone, isBoss: fromPhone === bossPhone, isTakeover: fromPhone === takeoverPhone });
    
    // Handle message from takeover number - conversation selector
    if (company.takeover_number && fromPhone === takeoverPhone) {
      console.log('Message from TAKEOVER NUMBER - checking session');
      
      const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
      const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
      
      // Clean up expired sessions
      await supabase
        .from('takeover_sessions')
        .delete()
        .lt('expires_at', new Date().toISOString());
      
      // Check for existing session
      const { data: session } = await supabase
        .from('takeover_sessions')
        .select('*')
        .eq('company_id', company.id)
        .eq('takeover_phone', fromPhone)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      
      // Check if message is a numeric selection (1, 2, 3, etc.)
      const numericSelection = parseInt(Body.trim());
      const isNumericSelection = !isNaN(numericSelection) && numericSelection > 0;
      
      // Get active conversations with human takeover
      const { data: activeConvs } = await supabase
        .from('conversations')
        .select('id, customer_name, phone, started_at, last_message_preview')
        .eq('company_id', company.id)
        .eq('status', 'active')
        .eq('human_takeover', true)
        .order('started_at', { ascending: false })
        .limit(10);
      
      // If numeric selection, update session
      if (isNumericSelection && activeConvs && activeConvs.length >= numericSelection) {
        const selectedConv = activeConvs[numericSelection - 1];
        
        // Update or create session
        await supabase
          .from('takeover_sessions')
          .upsert({
            company_id: company.id,
            takeover_phone: fromPhone,
            selected_conversation_id: selectedConv.id,
            expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() // 2 hours
          }, {
            onConflict: 'company_id,takeover_phone'
          });
        
        // Send confirmation
        if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
          const confirmMessage = `✅ Now responding to: ${selectedConv.customer_name || 'Unknown'} (${selectedConv.phone?.replace('whatsapp:', '')})\n\nSend your message to reply to this customer.`;
          
          const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
          const twilioFormData = new URLSearchParams();
          twilioFormData.append('From', company.whatsapp_number.startsWith('whatsapp:') ? company.whatsapp_number : `whatsapp:${company.whatsapp_number}`);
          twilioFormData.append('To', From);
          twilioFormData.append('Body', confirmMessage);
          
          await fetch(twilioUrl, {
            method: 'POST',
            headers: {
              'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: twilioFormData
          });
        }
        
        return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>`, {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' }
        });
      }
      
      // If no session or asking for menu, show conversation list
      if (!session || Body.toLowerCase().includes('menu') || Body.toLowerCase().includes('list')) {
        if (!activeConvs || activeConvs.length === 0) {
          // No active conversations
          if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
            const noConvsMessage = `No active conversations in takeover mode.\n\nTo start managing a conversation:\n1. Go to your dashboard\n2. Select a conversation\n3. Click "Take Over"\n4. You'll receive messages here`;
            
            const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
            const twilioFormData = new URLSearchParams();
            twilioFormData.append('From', company.whatsapp_number.startsWith('whatsapp:') ? company.whatsapp_number : `whatsapp:${company.whatsapp_number}`);
            twilioFormData.append('To', From);
            twilioFormData.append('Body', noConvsMessage);
            
            await fetch(twilioUrl, {
              method: 'POST',
              headers: {
                'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: twilioFormData
            });
          }
        } else {
          // Show menu of active conversations
          let menuMessage = `📱 *Active Conversations*\n\nReply with a number to select:\n\n`;
          
          activeConvs.forEach((conv, index) => {
            const customerDisplay = conv.customer_name || 'Unknown';
            const phoneDisplay = conv.phone?.replace('whatsapp:', '') || 'N/A';
            const preview = conv.last_message_preview ? `\n   "${conv.last_message_preview.substring(0, 60)}..."` : '';
            menuMessage += `*${index + 1}.* ${customerDisplay}\n   ${phoneDisplay}${preview}\n\n`;
          });
          
          menuMessage += `Send "menu" anytime to see this list again.`;
          
          if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
            const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
            const twilioFormData = new URLSearchParams();
            twilioFormData.append('From', company.whatsapp_number.startsWith('whatsapp:') ? company.whatsapp_number : `whatsapp:${company.whatsapp_number}`);
            twilioFormData.append('To', From);
            twilioFormData.append('Body', menuMessage);
            
            await fetch(twilioUrl, {
              method: 'POST',
              headers: {
                'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: twilioFormData
            });
          }
        }
        
        return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>`, {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' }
        });
      }
      
      // If session exists, forward message to selected conversation
      if (session && session.selected_conversation_id) {
        const { data: conversation } = await supabase
          .from('conversations')
          .select('*')
          .eq('id', session.selected_conversation_id)
          .single();
        
        if (conversation) {
          // Enable takeover mode if not already
          if (!conversation.human_takeover) {
            await supabase
              .from('conversations')
              .update({ 
                human_takeover: true,
                takeover_at: new Date().toISOString()
              })
              .eq('id', conversation.id);
          }
          
          // Store boss message
          await supabase
            .from('messages')
            .insert({
              conversation_id: conversation.id,
              role: 'assistant',
              content: Body
            });
          
          // Update session expiry
          await supabase
            .from('takeover_sessions')
            .update({
              expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
            })
            .eq('id', session.id);
          
          // Forward to customer
          if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
            const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
            const twilioFormData = new URLSearchParams();
            twilioFormData.append('From', company.whatsapp_number.startsWith('whatsapp:') ? company.whatsapp_number : `whatsapp:${company.whatsapp_number}`);
            twilioFormData.append('To', conversation.phone);
            twilioFormData.append('Body', Body);
            
            const twilioResponse = await fetch(twilioUrl, {
              method: 'POST',
              headers: {
                'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: twilioFormData
            });
            
            if (twilioResponse.ok) {
              console.log('[TAKEOVER] Message forwarded to customer');
            } else {
              const errorText = await twilioResponse.text();
              console.error('[TAKEOVER] Failed to forward:', twilioResponse.status, errorText);
            }
          }
        }
      }
      
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>`, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' }
      });
    }
    
    if (company.boss_phone && fromPhone === bossPhone) {
      console.log('Message from BOSS - Wake Up Routine + Command Handler');
      
      // Update admin_last_active to open 24-hour service window
      await supabase
        .from('companies')
        .update({ 
          admin_last_active: new Date().toISOString() 
        })
        .eq('id', company.id);
      
      console.log('[WAKE-UP] Boss activity logged, 24-hour service window active');
      
      // Check for "Unmute" command
      const trimmedBody = Body.trim().toLowerCase();
      
      if (trimmedBody === 'unmute' || trimmedBody.startsWith('unmute')) {
        console.log('[UNMUTE] Boss requesting to unmute a client');
        
        // Extract phone number if provided (e.g., "Unmute +260977123456")
        const phoneMatch = Body.match(/\+?\d{10,15}/);
        let targetPhone = phoneMatch ? phoneMatch[0] : null;
        
        if (!targetPhone) {
          // If no phone provided, get the most recent paused conversation
          const { data: recentPaused } = await supabase
            .from('conversations')
            .select('id, customer_name, phone')
            .eq('company_id', company.id)
            .eq('is_paused_for_human', true)
            .order('takeover_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          
          if (recentPaused) {
            targetPhone = recentPaused.phone;
          }
        }
        
        const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
        const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
        
        if (targetPhone) {
          // Normalize phone
          const normalizedTarget = targetPhone.replace(/[^\d]/g, '');
          
          // Unmute all conversations for this customer
          console.log(`[UNMUTE] 🔓 Boss manually unpausing conversations for ${targetPhone}`);
          
          const { data: unmuteResult } = await supabase
            .from('conversations')
            .update({ 
              is_paused_for_human: false,
              human_takeover: false
            })
            .eq('company_id', company.id)
            .eq('phone', `whatsapp:+${normalizedTarget}`)
            .select();
          
          console.log(`[UNMUTE] ✓ Unmuted ${unmuteResult?.length || 0} conversation(s) for ${targetPhone}`);
          console.log('[UNMUTE] Updated conversations:', unmuteResult?.map(c => c.id));
          
          // Send confirmation to Boss
          const confirmMsg = `✅ AI resumed for ${targetPhone}. Future messages will be handled automatically.`;
          
          const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
          const formData = new URLSearchParams();
          formData.append('From', company.whatsapp_number.startsWith('whatsapp:') ? company.whatsapp_number : `whatsapp:${company.whatsapp_number}`);
          formData.append('To', company.boss_phone.startsWith('whatsapp:') ? company.boss_phone : `whatsapp:${company.boss_phone}`);
          formData.append('Body', confirmMsg);
          
          await fetch(twilioUrl, {
            method: 'POST',
            headers: {
              'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData.toString(),
          });
        } else {
          // No client found to unmute
          const errorMsg = `❌ No paused clients found. Please specify phone number: "Unmute +260977123456"`;
          
          const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
          const formData = new URLSearchParams();
          formData.append('From', company.whatsapp_number.startsWith('whatsapp:') ? company.whatsapp_number : `whatsapp:${company.whatsapp_number}`);
          formData.append('To', company.boss_phone.startsWith('whatsapp:') ? company.boss_phone : `whatsapp:${company.boss_phone}`);
          formData.append('Body', errorMsg);
          
          await fetch(twilioUrl, {
            method: 'POST',
            headers: {
              'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData.toString(),
          });
        }
        
        // Return empty TwiML after unmute command
        return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
        });
      }
      
      // Store boss message in database (for non-unmute messages)
      await supabase
        .from('boss_conversations')
        .insert({
          company_id: company.id,
          message_from: 'management',
          message_content: Body
        });
      
      // Start background processing
      // @ts-ignore - EdgeRuntime is a Deno Deploy global
      EdgeRuntime.waitUntil(
        (async () => {
          try {
            console.log('[BOSS] Calling boss-chat function');
            
            // Call boss-chat function
            const { data: bossData, error: bossError } = await supabase.functions.invoke('boss-chat', {
              body: { From, Body, ProfileName: formData.get('ProfileName') }
            });
            
            if (bossError || !bossData?.response) {
              console.error('[BOSS] Boss chat error:', bossError);
              throw new Error('Boss chat failed');
            }
            
            console.log('[BOSS] Got response from boss-chat, sending via Twilio');
            
            const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
            const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
            
            // Clean formatting function - removes markdown and organizes text
            const cleanFormatting = (text: string): string => {
              return text
                // Remove markdown bold
                .replace(/\*\*([^*]+)\*\*/g, '$1')
                // Remove markdown italic
                .replace(/\*([^*]+)\*/g, '$1')
                // Remove markdown headers
                .replace(/^#+\s+/gm, '')
                // Clean up excessive newlines
                .replace(/\n{3,}/g, '\n\n')
                // Trim whitespace
                .trim();
            };
            
            // Split message into chunks if too long
            const splitMessage = (text: string, maxLength: number = 1500): string[] => {
              if (text.length <= maxLength) return [text];
              
              const chunks: string[] = [];
              let remaining = text;
              
              while (remaining.length > 0) {
                if (remaining.length <= maxLength) {
                  chunks.push(remaining);
                  break;
                }
                
                // Find last period, question mark, or newline before maxLength
                let splitIndex = remaining.lastIndexOf('.', maxLength);
                if (splitIndex === -1) splitIndex = remaining.lastIndexOf('?', maxLength);
                if (splitIndex === -1) splitIndex = remaining.lastIndexOf('\n', maxLength);
                if (splitIndex === -1) splitIndex = maxLength;
                
                chunks.push(remaining.substring(0, splitIndex + 1).trim());
                remaining = remaining.substring(splitIndex + 1).trim();
              }
              
              return chunks;
            };
            
            // Clean the response before splitting
            const cleanedResponse = cleanFormatting(bossData.response);
            const responseChunks = splitMessage(cleanedResponse);
            console.log(`[BOSS] Sending ${responseChunks.length} message chunk(s)`);
            
            // Send each chunk sequentially
            for (let i = 0; i < responseChunks.length; i++) {
              const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
              const twilioFormData = new URLSearchParams();
              twilioFormData.append('From', To);
              twilioFormData.append('To', From);
              twilioFormData.append('Body', responseChunks[i]);
              
              const twilioResponse = await fetch(twilioUrl, {
                method: 'POST',
                headers: {
                  'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: twilioFormData
              });
              
              if (twilioResponse.ok) {
                console.log(`[BOSS] Chunk ${i+1}/${responseChunks.length} sent successfully`);
              } else {
                const errorText = await twilioResponse.text();
                console.error(`[BOSS] Failed to send chunk ${i+1}:`, twilioResponse.status, errorText);
              }
              
              // Add small delay between messages
              if (i < responseChunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
              }
            }
          } catch (error) {
            console.error('[BOSS] Error in background processing:', error);
          }
        })()
      );
      
      // Return empty TwiML immediately
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>`, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' }
      });
    }

    // Customer message handling
    console.log('Processing customer message');

    // Check credit balance
    if (company.credit_balance <= 0) {
      const offlineMessage = "Our assistant is currently offline. A human will message you shortly.";
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[${offlineMessage}]]></Message>
</Response>`, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
      });
    }

    const customerPhone = From.replace('whatsapp:', '');
    
    // Find or create conversation
    let { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('*')
      .eq('company_id', company.id)
      .eq('phone', From)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    // Early pause check removed - routing system now manages pause state dynamically
    // Human takeover check removed - routing system now manages takeover state dynamically
    
    if (convError || !conversation) {
      console.log(`[CONVERSATION] 🆕 Creating new conversation for ${customerPhone}`);
      
      const { data: newConv, error: createError } = await supabase
        .from('conversations')
        .insert({
          company_id: company.id,
          phone: From,
          status: 'active',
          transcript: `CUSTOMER PHONE: ${customerPhone}\n`
        })
        .select()
        .single();

      if (createError) {
        console.error('[CONVERSATION] ❌ Error creating conversation:', createError);
        throw createError;
      }
      conversation = newConv;
      console.log(`[CONVERSATION] ✓ New conversation created with ID: ${conversation.id}`);
    } else {
      console.log(`[CONVERSATION] 📝 Using existing conversation ${conversation.id}`);
      console.log(`[CONVERSATION] Current state - Paused: ${conversation.is_paused_for_human}, Handoff: ${conversation.human_takeover}, Agent: ${conversation.active_agent || 'none'}`);
    }

    // Deduct credits
    await supabase.rpc('deduct_credits', {
      p_company_id: company.id,
      p_amount: 1,
      p_reason: 'whatsapp_message',
      p_conversation_id: conversation.id
    });
    
    // Handle media files
    const storedMediaUrls: string[] = [];
    const storedMediaTypes: string[] = [];
    
    if (mediaFiles.length > 0) {
      console.log(`Processing ${mediaFiles.length} media files`);
      
      for (let i = 0; i < mediaFiles.length; i++) {
        const media = mediaFiles[i];
        try {
          const mediaResponse = await fetch(media.url);
          if (!mediaResponse.ok) continue;
          
          const mediaBlob = await mediaResponse.arrayBuffer();
          const fileExt = media.contentType.split('/')[1] || 'bin';
          const fileName = `${conversation.id}/${Date.now()}_${i}.${fileExt}`;
          
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('conversation-media')
            .upload(fileName, mediaBlob, {
              contentType: media.contentType,
              upsert: false
            });
          
          if (uploadError) {
            console.error(`Upload error:`, uploadError);
            continue;
          }
          
          const { data: { publicUrl } } = supabase.storage
            .from('conversation-media')
            .getPublicUrl(fileName);
          
          storedMediaUrls.push(publicUrl);
          storedMediaTypes.push(media.contentType);
          console.log(`Media ${i} stored:`, publicUrl);
        } catch (error) {
          console.error(`Media processing error:`, error);
        }
      }
    }

    // Insert user message immediately
    const messageMetadata = {
      media_urls: storedMediaUrls,
      media_types: storedMediaTypes,
      media_count: storedMediaUrls.length,
      message_type: storedMediaUrls.length > 0 
        ? (Body ? 'text_with_media' : 'media')
        : 'text'
    };
    
    await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        role: 'user',
        content: Body || (storedMediaUrls.length > 0 ? 'Sent media' : ''),
        message_metadata: messageMetadata
      });

    console.log('User message stored, starting background AI processing');

    // Start background processing - THIS IS THE KEY CHANGE
    // @ts-ignore - EdgeRuntime is a Deno Deploy global
    EdgeRuntime.waitUntil(
      processAIResponse(
        conversation.id,
        company.id,
        Body,
        storedMediaUrls,
        storedMediaTypes,
        customerPhone
      )
    );

    // Return empty TwiML response (no immediate message to customer)
    const immediateTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>`;

    console.log('Returning immediate TwiML response at:', new Date().toISOString());

    return new Response(immediateTwiml, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
    });

  } catch (error) {
    console.error("Error in WhatsApp handler:", error);
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[Sorry, I encountered an error. Please try again or contact us directly.]]></Message>
</Response>`, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
    });
  }
});
