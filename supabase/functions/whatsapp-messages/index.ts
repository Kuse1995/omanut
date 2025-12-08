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

// Agent routing function with configurable model from database
async function routeToAgent(
  userMessage: string,
  conversationHistory: any[],
  config?: {
    routingModel?: string;
    routingTemperature?: number;
    confidenceThreshold?: number;
  }
): Promise<{ agent: 'support' | 'sales' | 'boss'; reasoning: string; confidence: number }> {
  
  const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY');
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  
  // Use configured values or defaults
  const routingModel = config?.routingModel || 'deepseek-chat';
  const routingTemperature = config?.routingTemperature ?? 0.3;
  const confidenceThreshold = config?.confidenceThreshold ?? 0.6;
  
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

  console.log(`[ROUTER] Using routing model: ${routingModel}, temperature: ${routingTemperature}`);

  try {
    let response;
    
    // Check if using DeepSeek or Lovable AI Gateway
    if (routingModel === 'deepseek-chat' && DEEPSEEK_API_KEY) {
      response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: routingModel,
          messages: [
            { role: 'system', content: 'You are an intent classifier. Respond only with valid JSON.' },
            { role: 'user', content: routingPrompt }
          ],
          temperature: routingTemperature,
          max_tokens: 150
        })
      });
    } else {
      // Use Lovable AI Gateway for other models (Gemini, GPT, etc.)
      response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: routingModel,
          messages: [
            { role: 'system', content: 'You are an intent classifier. Respond only with valid JSON.' },
            { role: 'user', content: routingPrompt }
          ],
          temperature: routingTemperature,
          max_tokens: 150
        })
      });
    }
    
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
  
  // Debug logging for reservation tracking
  const hasEmail = userMessage.includes('@');
  const hasName = /[A-Z][a-z]+\s+[A-Z][a-z]+/.test(userMessage);
  const hasGuests = /\d+\s*(guest|people|person|pax)/i.test(userMessage);
  console.log('[RESERVATION-CHECK] Message analysis:', {
    customerPhone,
    hasEmail,
    hasName,
    hasGuests,
    messagePreview: userMessage.substring(0, 100)
  });
  
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Analyze customer images if present
  let imageAnalysisContext = '';
  if (storedMediaUrls.length > 0) {
    console.log('[IMAGE-ANALYSIS] Analyzing customer images:', storedMediaUrls.length);
    for (let i = 0; i < storedMediaUrls.length; i++) {
      const mediaUrl = storedMediaUrls[i];
      const mediaType = storedMediaTypes[i] || '';
      
      // Only analyze images
      if (mediaType.startsWith('image/')) {
        try {
          const analysisResponse = await fetch(
            `${Deno.env.get('SUPABASE_URL')}/functions/v1/analyze-customer-image`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageUrl: mediaUrl })
            }
          );
          
          if (analysisResponse.ok) {
            const analysis = await analysisResponse.json();
            console.log('[IMAGE-ANALYSIS] Result:', analysis);
            
            if (analysis.isPaymentProof && analysis.confidence > 0.7) {
              imageAnalysisContext += `\n🔔 PAYMENT PROOF DETECTED (${Math.round(analysis.confidence * 100)}% confidence):\n`;
              if (analysis.extractedData.amount) imageAnalysisContext += `- Amount: ${analysis.extractedData.amount}\n`;
              if (analysis.extractedData.transactionReference) imageAnalysisContext += `- Reference: ${analysis.extractedData.transactionReference}\n`;
              if (analysis.extractedData.senderName) imageAnalysisContext += `- Sender: ${analysis.extractedData.senderName}\n`;
              if (analysis.extractedData.provider) imageAnalysisContext += `- Provider: ${analysis.extractedData.provider}\n`;
              imageAnalysisContext += `Action: Acknowledge receipt and inform customer that payment proof has been received for verification.\n`;
            } else {
              imageAnalysisContext += `\nCustomer shared an image: ${analysis.description} (Category: ${analysis.category})\n`;
            }
          }
        } catch (imgError) {
          console.error('[IMAGE-ANALYSIS] Error:', imgError);
        }
      }
    }
  }

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
    
    // Fetch AI overrides EARLY - needed for routing configuration
    const { data: aiOverrides } = await supabase
      .from('company_ai_overrides')
      .select('*')
      .eq('company_id', company.id)
      .maybeSingle();
    
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

    if (agentRoutingEnabled && aiOverrides?.routing_enabled !== false) {
      try {
        console.log('[ROUTER] Classifying intent...');
        console.log(`[ROUTER] Current active agent: ${previousAgent}`);
        console.log(`[ROUTER] Message to classify: "${userMessage.substring(0, 100)}${userMessage.length > 100 ? '...' : ''}"`);
        
        // Pass routing configuration from database
        const routingConfig = {
          routingModel: aiOverrides?.routing_model || 'deepseek-chat',
          routingTemperature: aiOverrides?.routing_temperature ?? 0.3,
          confidenceThreshold: aiOverrides?.routing_confidence_threshold ?? 0.6
        };
        
        const routingResult = await routeToAgent(userMessage, messageHistory || [], routingConfig);
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

    // Note: aiOverrides already fetched earlier for routing configuration

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

    // ========== AGENT-SPECIFIC SYSTEM PROMPTS (from database or defaults) ==========
    let agentPersonality = '';
    
    if (selectedAgent === 'support') {
      // Use custom support agent prompt from database, or default
      agentPersonality = aiOverrides?.support_agent_prompt || `

🛠️ YOU ARE THE SUPPORT AGENT:
- Your role is to EMPATHIZE and RESOLVE customer issues
- Listen carefully to complaints and acknowledge their frustration
- Apologize sincerely when appropriate
- Provide clear step-by-step solutions
- Be patient, helpful, and understanding
- Focus on making things right for the customer
- If you cannot resolve the issue, escalate by using [HANDOFF_REQUIRED]`;
    } else if (selectedAgent === 'sales') {
      // Use custom sales agent prompt from database, or default
      agentPersonality = aiOverrides?.sales_agent_prompt || `

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
    
    console.log(`[AI-CONFIG] Agent personality loaded for ${selectedAgent}:`, {
      isCustomPrompt: selectedAgent === 'support' ? !!aiOverrides?.support_agent_prompt : !!aiOverrides?.sales_agent_prompt,
      promptLength: agentPersonality.length
    });

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

    instructions += `\n\nCONVERSATION MEMORY & CONTEXT - CRITICAL:
- ALWAYS review the conversation history before asking questions
- If customer already provided name, email, phone, or guest count, EXTRACT IT from conversation
- NEVER ask for information the customer already gave you
- Example: If customer says "John, john@email.com, 3 guests" → you have name, email, and guests
- If customer provided partial info across multiple messages, extract ALL of it before proceeding
- The customer's WhatsApp phone number is always available from the conversation

AUTOMATIC BOSS NOTIFICATIONS:
You have access to tools that automatically notify the boss in these situations:
- New reservations (automatically sent)
- Payment proof uploads (automatically sent)
- Reservation changes/cancellations (automatically sent via notify_boss tool)
- High-value opportunities: 10+ guests, corporate events, VIP mentions (use notify_boss tool)
- Customer complaints/negative sentiment (use notify_boss tool)
- Important client information capture (use notify_boss tool)

CURRENT DATE & TIME (Zambia):
📅 ${new Date().toLocaleString('en-US', { 
  timeZone: 'Africa/Lusaka',
  weekday: 'long',
  year: 'numeric', 
  month: 'long', 
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})}

CRITICAL DATE VALIDATION:
- ALWAYS validate that requested dates are in the FUTURE
- If customer requests a past date, politely inform them and ask for a future date
- Example: If today is Nov 25, 2025 and customer asks for Nov 20, respond:
  "I notice that date has already passed. Did you mean a date coming up? When would you like to visit?"
- Accept "today", "tomorrow", "this weekend" and convert to actual dates using get_date_info tool
- For same-day bookings, check if the requested time hasn't passed yet

Key Guidelines:
1. Be warm, friendly, and professional
2. Answer questions about our business using the information above
3. RESERVATION WORKFLOW - MANDATORY STEPS (DO NOT SKIP):
   
   STEP 1 - DATE VALIDATION:
   - When customer mentions ANY date, IMMEDIATELY call get_date_info tool
   - If date is in past, inform customer and ask for future date
   - Only proceed once you have a VALID FUTURE DATE
   
   STEP 2 - CALENDAR CHECK:
   - Call check_calendar_availability with the validated date and proposed time
   - If slot is busy, suggest alternatives
   - Only proceed once you have a CONFIRMED AVAILABLE SLOT
   
   STEP 3 - COLLECT ALL REQUIRED INFORMATION:
   YOU MUST HAVE ALL 6 ITEMS BEFORE CREATING RESERVATION:
   1. ✅ Customer name - Look in conversation for "I'm John", "Abraham here", "My name is X"
   2. ✅ Phone number - ALWAYS available from WhatsApp conversation (use customerPhone variable)
   3. ✅ Email address - Look for @ symbol in messages, ask ONCE if not provided: "What's your email address?"
   4. ✅ Date - Already validated in Step 1
   5. ✅ Time - Ask: "What time would you prefer?" (use 24-hour format HH:MM)
   6. ✅ Number of guests - Look for "3 guests", "party of 4", ask: "How many guests?"
   
   OPTIONAL INFORMATION (nice to have but not required):
   - Occasion: "Is this for a special occasion?"
   - Area preference: "Do you have a seating preference?"
   
   🚨 CRITICAL RULES - READ CAREFULLY:
   - DO NOT say "Done!" or "All set!" until you call create_reservation tool
   - DO NOT skip information collection - you need all 6 required items
   - DO NOT make assumptions - if customer didn't provide info, ASK for it
   - DO NOT create reservation without email - it's REQUIRED
   - Review conversation history FIRST - customer may have already provided info
   - If customer said "Abraham, abkanyanta@gmail.com, 3 guests" in one message → you have name, email, guests
   
   🔍 AFTER CUSTOMER PROVIDES INFORMATION - MANDATORY CHECK:
    When customer responds with name, email, or guest count:
    1. PAUSE - Do NOT send any reply yet
    2. REVIEW conversation - Extract all 6 required fields:
       - Name: Look for "I'm X", "My name is X", "X here", or name in latest message
       - Email: Look for pattern with @ symbol
       - Guests: Look for numbers like "3 guests", "5 people", "party of 4"
       - Phone: ALWAYS available (${conversation.phone})
       - Date: From previous get_date_info tool result or conversation
       - Time: From previous conversation or calendar check
    3. COUNT how many of 6 items you have
    4. If count === 6 → IMMEDIATELY call create_reservation (DO NOT send text reply first)
    5. If count < 6 → Send reply asking ONLY for missing items

    EXAMPLE - Customer says "Abraham, abraham@email.com, 5 guests":
    ✅ Extracted: name=Abraham, email=abraham@email.com, guests=5
    ✅ Already have: phone, date, time
    ✅ Count: 6/6 → CALL create_reservation tool immediately
    ❌ Do NOT say "Got it!" or "I processed your request" without calling the tool
    
    STEP 4 - CREATE RESERVATION:
    Once you have all 6 required items, IMMEDIATELY call create_reservation tool.
    DO NOT ask "Should I book this?" - just create it.
    
    STEP 5 - CONFIRM TO CUSTOMER:
    After create_reservation tool executes, explain:
    "Perfect! Your reservation request for [DATE] at [TIME] for [GUESTS] guests has been received.
    Our team will review and send confirmation within a few hours. Thank you! 🙏"
   
   🔔 BOSS NOTIFICATION (AUTOMATIC):
   - The create_reservation tool AUTOMATICALLY notifies the boss
   - You do NOT need to call notify_boss separately for new reservations
   - Boss receives: date, time, guests, customer details, and approval options
   
   ALL RESERVATIONS REQUIRE BOSS CONFIRMATION:
   - Make this clear to customers: "Your request will be reviewed by our team"
   - Status starts as pending_boss_approval
4. For payments, collect info conversationally then use request_payment tool
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
12. CRITICAL - NO REPETITIVE QUESTIONS:
    - Before asking ANY question, check if the answer is in conversation history
    - If customer already provided partial information, acknowledge it and only ask for missing pieces
    - Example: If customer said "Abraham, 3 guests", respond with:
      "Perfect! I have Abraham and 3 guests. I just need your email address to complete the booking."
    - NEVER ask for the same information twice
    - If unsure, send the flow with whatever info you have in prefill_data - the form handles the rest

AUTOMATIC NOTIFICATION DETECTION:
When you detect these scenarios, call notify_boss tool immediately:
- High-value opportunity: 10+ guests, "corporate", "business event", "conference"
- Reservation cancellation: "cancel my booking", "need to cancel"
- Reservation change request: "change my reservation", "different time"
- Complaint/negative sentiment: "disappointed", "unhappy", "terrible", "worst", "angry"
- VIP/important info: Customer mentions being a regular, celebrity, VIP treatment needed

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

    // Add image analysis context if present
    const fullUserMessage = imageAnalysisContext 
      ? `${userMessage}\n\n[IMAGE ANALYSIS CONTEXT]:${imageAnalysisContext}` 
      : userMessage;
    messages.push({ role: 'user', content: fullUserMessage });

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

    // ========== DYNAMIC AI CONFIGURATION FROM DATABASE ==========
    // Use AI overrides from company_ai_overrides table instead of hardcoded values
    const primaryModel = aiOverrides?.primary_model || 'google/gemini-3-pro-preview';
    const fallbackModel = 'google/gemini-2.5-flash';
    
    // Select model based on complexity - use configured primary for complex, fallback for simple
    const selectedModel = messageComplexity === 'simple' ? fallbackModel : primaryModel;
    const configuredMaxTokens = aiOverrides?.max_tokens || 8192;
    const maxTokens = messageComplexity === 'simple' ? Math.min(2048, configuredMaxTokens) : configuredMaxTokens;
    const temperature = aiOverrides?.primary_temperature || 1.0;
    const responseTimeout = (aiOverrides?.response_timeout_seconds || 60) * 1000;
    const fallbackMessage = aiOverrides?.fallback_message || "Thank you for your message. I'm looking into that for you - someone will respond shortly. 🙏";
    
    console.log(`[AI-CONFIG] Using database configuration:`, {
      primaryModel,
      selectedModel,
      maxTokens,
      temperature,
      responseTimeout: responseTimeout / 1000 + 's',
      hasFallbackMessage: !!aiOverrides?.fallback_message
    });

    // Call Lovable AI Gateway with configurable timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), responseTimeout);
    
    let assistantReply = '';
    let anyToolExecuted = false;
    let toolExecutionContext: string[] = [];
    let toolResults: Array<{tool_call_id: string, role: string, content: string}> = [];
    let aiData: any = null; // Store AI response for tool loop

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
          temperature,
          max_tokens: maxTokens,
          tools: [
            {
              type: "function",
              function: {
                name: "create_reservation",
                description: "Create a new reservation in the database with pending_boss_approval status. Use this IMMEDIATELY after you have collected: name, phone, email, date, time, guests. Extract information from conversation history before calling this.",
                parameters: {
                  type: "object",
                  properties: {
                    customer_name: { type: "string", description: "Customer's full name extracted from conversation" },
                    phone: { type: "string", description: "Customer's phone number (WhatsApp number always available)" },
                    email: { type: "string", description: "Customer's email address" },
                    date: { type: "string", description: "Reservation date (YYYY-MM-DD)" },
                    time: { type: "string", description: "Reservation time (HH:MM format, 24-hour)" },
                    guests: { type: "number", description: "Number of guests" },
                    occasion: { type: "string", description: "Special occasion (optional)" },
                    area_preference: { type: "string", description: "Seating area preference (optional)" }
                  },
                  required: ["customer_name", "phone", "email", "date", "time", "guests"]
                }
              }
            },
            {
              type: "function",
              function: {
                name: "get_date_info",
                description: "Get information about dates. Use this to convert relative dates like 'tomorrow', 'next Monday', 'this weekend' into actual YYYY-MM-DD format, or to validate if a date is in the future.",
                parameters: {
                  type: "object",
                  properties: {
                    query: { 
                      type: "string", 
                      description: "Date query like 'tomorrow', 'next Monday', 'this Friday', or specific date to validate like '2025-11-20'" 
                    }
                  },
                  required: ["query"]
                }
              }
            },
            {
              type: "function",
              function: {
                name: "notify_boss",
                description: "Send an immediate notification to the boss for important situations: high-value opportunities (10+ guests, corporate events), complaints, reservation changes/cancellations, VIP information. Use when customer situation requires owner attention.",
                parameters: {
                  type: "object",
                  properties: {
                    notification_type: { 
                      type: "string", 
                      enum: ["high_value", "complaint", "reservation_change", "cancellation", "vip_info"],
                      description: "Type of notification to send"
                    },
                    priority: {
                      type: "string",
                      enum: ["high", "urgent"],
                      description: "Priority level - use urgent for complaints or cancellations"
                    },
                    summary: { 
                      type: "string", 
                      description: "Brief summary of the situation (1-2 sentences)"
                    },
                    details: {
                      type: "string",
                      description: "Additional context or customer message"
                    }
                  },
                  required: ["notification_type", "priority", "summary"]
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
                description: "Check reservation database for scheduling conflicts. Always call BEFORE sending reservation form to customer. Returns conflict status and suggests alternatives if busy.",
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
                description: "Notify boss about pending reservation for approval. Automatically called after customer completes reservation form. Boss will receive context about the day's schedule and approve/reject.",
                parameters: {
                  type: "object",
                  properties: {
                    reservation_id: { type: "string", description: "Reservation UUID from database to notify boss about" },
                    title: { type: "string", description: "Reservation title (e.g., 'Reservation: John Doe - 4 guests')" },
                    description: { type: "string", description: "Additional reservation details or notes" },
                    send_notifications: { type: "boolean", description: "Deprecated - kept for compatibility" }
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

      aiData = await response.json();
      assistantReply = aiData.choices[0].message.content || '';
      const toolCalls = aiData.choices[0].message.tool_calls;

      // Enhanced logging for AI decision making
      console.log('[AI-TOOLS] Response from AI:', {
        hasReply: !!assistantReply,
        replyPreview: assistantReply?.substring(0, 150) + (assistantReply?.length > 150 ? '...' : ''),
        hasToolCalls: !!aiData.choices[0].message.tool_calls,
        toolCount: aiData.choices[0].message.tool_calls?.length || 0,
        toolNames: aiData.choices[0].message.tool_calls?.map((t: any) => t.function.name) || []
      });
      
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
            console.log('[BACKGROUND] Checking database availability:', args);
            
            try {
              // Check database for conflicting reservations
              const requestedDateTime = new Date(`${args.date} ${args.time}`);
              const bufferMinutes = 120; // 2 hour buffer
              const startTime = new Date(requestedDateTime.getTime() - bufferMinutes * 60000);
              const endTime = new Date(requestedDateTime.getTime() + bufferMinutes * 60000);
              
              const { data: conflicts, error: conflictError } = await supabase
                .from('reservations')
                .select('name, time, guests, status')
                .eq('company_id', company.id)
                .eq('date', args.date)
                .in('status', ['pending_boss_approval', 'confirmed']);
              
              if (conflictError) {
                console.error('[BACKGROUND] Database check error:', conflictError);
                toolExecutionContext.push('database unavailable - proceeding without availability check');
                
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
                const hasConflicts = conflicts && conflicts.length > 0;
                
                if (!hasConflicts) {
                  toolExecutionContext.push(`Time slot ${args.date} ${args.time} is AVAILABLE - NOW SEND RESERVATION FLOW`);
                  console.log('[BACKGROUND] Availability confirmed, automatically sending reservation flow');
                  
                  // Automatically send reservation flow after confirming availability
                  try {
                    const flowResponse = await supabase.functions.invoke('send-whatsapp-flow', {
                      body: {
                        flow_type: 'reservation',
                        header_text: '📋 Complete Your Reservation',
                        button_text: 'Fill Details',
                        prefill_data: {},
                        customer_phone: `whatsapp:${customerPhone}`,
                        company_id: company.id
                      }
                    });
                    
                    if (flowResponse.error) {
                      console.error('[BACKGROUND] Flow send error:', flowResponse.error);
                      assistantReply = `Great news! ${args.time} on ${args.date} is available. Please note that all reservations require final confirmation from our team. Please provide your name, email, and number of guests.`;
                    } else {
                      console.log('[BACKGROUND] Reservation flow sent successfully');
                      toolExecutionContext.push('sent reservation flow to customer');
                      assistantReply = `Perfect! ${args.time} on ${args.date} looks available. I've sent you a form to complete your reservation details. Please note that all reservations require final confirmation from our team. 📋`;
                    }
                  } catch (flowError) {
                    console.error('[BACKGROUND] Error sending flow:', flowError);
                    assistantReply = `Great news! ${args.time} on ${args.date} is available. Please note that reservations require team confirmation. Please provide your name, email, and number of guests.`;
                  }
                } else {
                  const conflictDetails = conflicts.map(c => `${c.time} (${c.guests} guests${c.status === 'pending_boss_approval' ? ' - pending' : ''})`).join(', ');
                  toolExecutionContext.push(`Time slot ${args.date} ${args.time} has ${conflicts.length} booking(s): ${conflictDetails}`);
                  assistantReply = `I checked our schedule and ${args.time} on ${args.date} has ${conflicts.length} booking(s) around that time. ` +
                    `Would you like to try a different time? I can suggest alternative slots for you.`;
                }
              }
            } catch (error) {
              console.error('[BACKGROUND] Calendar availability error:', error);
              toolExecutionContext.push('calendar check failed - proceeding without availability');
            }
          } else if (toolCall.function.name === 'create_calendar_event') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('[BACKGROUND] Notifying boss about reservation:', args);
            
            try {
              // Send boss notification instead of creating calendar event
              const { data: bossData, error: bossError } = await supabase.functions.invoke('send-boss-reservation-request', {
                body: {
                  reservationId: args.reservation_id
                }
              });
              
              if (bossError) {
                console.error('[BACKGROUND] Boss notification error:', bossError);
                toolExecutionContext.push('boss notification failed - reservation saved but boss not notified');
              } else {
                anyToolExecuted = true;
                toolExecutionContext.push('boss notified about pending reservation');
                console.log('[BACKGROUND] Boss notification sent successfully');
              }
            } catch (error) {
              console.error('[BACKGROUND] Boss notification error:', error);
              toolExecutionContext.push('boss notification failed - reservation saved but boss not notified');
            }
          } else if (toolCall.function.name === 'create_reservation') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('[RESERVATION-ATTEMPT] Tool called with arguments:', JSON.stringify(args));
            
            // Validate all required fields are present
            const missingFields = [];
            if (!args.customer_name) missingFields.push('customer_name');
            if (!args.phone && !customerPhone) missingFields.push('phone');
            if (!args.email) missingFields.push('email');
            if (!args.date) missingFields.push('date');
            if (!args.time) missingFields.push('time');
            if (!args.guests) missingFields.push('guests');
            
            if (missingFields.length > 0) {
              console.error('[RESERVATION-BLOCKED] Missing required fields:', missingFields);
              toolExecutionContext.push(`reservation blocked - missing: ${missingFields.join(', ')}`);
              
              const fieldLabels: Record<string, string> = {
                customer_name: 'your name',
                phone: 'your phone number',
                email: 'your email address',
                date: 'the date',
                time: 'the time',
                guests: 'the number of guests'
              };
              
              const missingLabels = missingFields.map(f => fieldLabels[f] || f);
              assistantReply = `To complete your reservation, I still need: ${missingLabels.join(', ')}. Could you please provide these details?`;
              anyToolExecuted = true;
              continue;
            }
            
            console.log('[RESERVATION-CREATE] All required fields present, proceeding...');
            const reservationPhone = args.phone || customerPhone;
            
            try {
              // Create reservation with pending_boss_approval status
              const { data: reservation, error: resError } = await supabase
                .from('reservations')
                .insert({
                  company_id: company.id,
                  conversation_id: conversationId,
                  name: args.customer_name,
                  phone: reservationPhone,
                  email: args.email,
                  date: args.date,
                  time: args.time,
                  guests: args.guests,
                  occasion: args.occasion || null,
                  area_preference: args.area_preference || null,
                  branch: null,
                  status: 'pending_boss_approval'
                })
                .select()
                .single();

              if (resError) {
                console.error('[BACKGROUND] Reservation error:', resError);
                toolExecutionContext.push('reservation creation failed');
                
                toolResults.push({
                  tool_call_id: toolCall.id,
                  role: "tool",
                  content: JSON.stringify({
                    success: false,
                    error: 'Failed to create reservation',
                    message: 'Database error occurred. Please try again or contact support'
                  })
                });
                
                assistantReply = "I encountered an error saving your reservation. Please contact us directly.";
              } else {
                anyToolExecuted = true;
                toolExecutionContext.push(`created reservation for ${args.customer_name} - pending boss approval`);
                console.log('[BACKGROUND] Reservation created:', reservation.id);
                
                toolResults.push({
                  tool_call_id: toolCall.id,
                  role: "tool",
                  content: JSON.stringify({
                    success: true,
                    reservation_id: reservation.id,
                    customer_name: args.customer_name,
                    date: args.date,
                    time: args.time,
                    guests: args.guests,
                    status: 'pending_boss_approval',
                    message: 'Reservation created successfully and boss has been notified for approval'
                  })
                });
                
                // Update conversation with customer name
                await supabase
                  .from('conversations')
                  .update({ customer_name: args.customer_name })
                  .eq('id', conversationId);
                
                // Notify boss about new reservation request with enhanced logging
                console.log('[BOSS-NOTIFY] Attempting to notify boss about reservation:', reservation.id);
                console.log('[BOSS-NOTIFY] Boss phone:', company.boss_phone);
                console.log('[BOSS-NOTIFY] Company ID:', company.id);
                
                try {
                  const { data: bossNotifyData, error: notifyError } = await supabase.functions.invoke('send-boss-reservation-request', {
                    body: {
                      reservation_id: reservation.id,
                      company_id: company.id
                    }
                  });

                  if (notifyError) {
                    console.error('[BOSS-NOTIFY] Failed to send notification:', notifyError);
                    console.error('[BOSS-NOTIFY] Error details:', JSON.stringify(notifyError));
                  } else {
                    console.log('[BOSS-NOTIFY] ✅ Boss notification sent successfully');
                    console.log('[BOSS-NOTIFY] Response:', JSON.stringify(bossNotifyData));
                  }
                } catch (notifyError) {
                  console.error('[BOSS-NOTIFY] Exception while notifying boss:', notifyError);
                  console.error('[BOSS-NOTIFY] Exception details:', JSON.stringify(notifyError, Object.getOwnPropertyNames(notifyError)));
                }
                
                assistantReply = `Perfect! Your reservation request for ${args.date} at ${args.time} for ${args.guests} guest${args.guests > 1 ? 's' : ''} has been received. Our team will review and send you confirmation within a few hours. Thank you! 🙏`;
              }
            } catch (error) {
              console.error('[BACKGROUND] Exception in create_reservation:', error);
              toolExecutionContext.push('reservation creation exception');
              assistantReply = "I encountered an error saving your reservation. Please contact us directly.";
            }
          } else if (toolCall.function.name === 'get_date_info') {
            const args = JSON.parse(toolCall.function.arguments);
            const now = new Date();
            const lusaka = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Lusaka' }));
            
            let resultDate = null;
            let isPast = false;
            const query = args.query.toLowerCase();
            
            // Handle relative dates
            if (query.includes('today')) {
              resultDate = lusaka;
            } else if (query.includes('tomorrow')) {
              resultDate = new Date(lusaka);
              resultDate.setDate(resultDate.getDate() + 1);
            } else if (query.includes('next monday') || query.includes('monday')) {
              resultDate = new Date(lusaka);
              const daysUntilMonday = (1 - resultDate.getDay() + 7) % 7 || 7;
              resultDate.setDate(resultDate.getDate() + daysUntilMonday);
            } else if (query.includes('next tuesday') || query.includes('tuesday')) {
              resultDate = new Date(lusaka);
              const daysUntilTuesday = (2 - resultDate.getDay() + 7) % 7 || 7;
              resultDate.setDate(resultDate.getDate() + daysUntilTuesday);
            } else if (query.includes('next wednesday') || query.includes('wednesday')) {
              resultDate = new Date(lusaka);
              const daysUntilWednesday = (3 - resultDate.getDay() + 7) % 7 || 7;
              resultDate.setDate(resultDate.getDate() + daysUntilWednesday);
            } else if (query.includes('next thursday') || query.includes('thursday')) {
              resultDate = new Date(lusaka);
              const daysUntilThursday = (4 - resultDate.getDay() + 7) % 7 || 7;
              resultDate.setDate(resultDate.getDate() + daysUntilThursday);
            } else if (query.includes('next friday') || query.includes('friday')) {
              resultDate = new Date(lusaka);
              const daysUntilFriday = (5 - resultDate.getDay() + 7) % 7 || 7;
              resultDate.setDate(resultDate.getDate() + daysUntilFriday);
            } else if (query.includes('next saturday') || query.includes('saturday')) {
              resultDate = new Date(lusaka);
              const daysUntilSaturday = (6 - resultDate.getDay() + 7) % 7 || 7;
              resultDate.setDate(resultDate.getDate() + daysUntilSaturday);
            } else if (query.includes('next sunday') || query.includes('sunday')) {
              resultDate = new Date(lusaka);
              const daysUntilSunday = (7 - resultDate.getDay() + 7) % 7 || 7;
              resultDate.setDate(resultDate.getDate() + daysUntilSunday);
            } else if (query.includes('this weekend')) {
              resultDate = new Date(lusaka);
              const daysUntilSaturday = (6 - resultDate.getDay() + 7) % 7;
              resultDate.setDate(resultDate.getDate() + daysUntilSaturday);
            } else {
              // Try to parse as actual date
              try {
                resultDate = new Date(query);
                if (isNaN(resultDate.getTime())) {
                  resultDate = null;
                }
              } catch (e) {
                resultDate = null;
              }
            }
            
            if (resultDate) {
              isPast = resultDate < lusaka;
              const formatted = resultDate.toISOString().split('T')[0];
              const dayName = resultDate.toLocaleDateString('en-US', { weekday: 'long' });
              
              console.log(`[DATE-INFO] Query: "${query}" -> ${formatted} (${dayName})${isPast ? ' - PAST' : ''}`);
              
              // Push to toolResults for AI to process
              toolResults.push({
                tool_call_id: toolCall.id,
                role: "tool",
                content: JSON.stringify({
                  date: formatted,
                  day_name: dayName,
                  is_past: isPast,
                  current_date: lusaka.toISOString().split('T')[0],
                  message: isPast ? 'This date is in the past' : 'This date is valid'
                })
              });
              
              toolExecutionContext.push(`date_info: ${formatted} (${dayName})${isPast ? ' [PAST DATE - INVALID]' : ' [FUTURE DATE - OK]'}`);
              anyToolExecuted = true;
            } else {
              console.log(`[DATE-INFO] Could not parse date query: "${query}"`);
              
              toolResults.push({
                tool_call_id: toolCall.id,
                role: "tool",
                content: JSON.stringify({ error: 'Could not parse date', message: 'Please specify the date more clearly' })
              });
              
              toolExecutionContext.push(`date_info: unable to parse "${query}"`);
              anyToolExecuted = true;
            }
          } else if (toolCall.function.name === 'notify_boss') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('[BACKGROUND] notify_boss called with:', JSON.stringify(args));
            
            try {
              // Map notification types to message formats
              let emoji = '📢';
              let title = 'Notification';
              
              switch (args.notification_type) {
                case 'high_value':
                  emoji = '💎';
                  title = 'High-Value Opportunity';
                  break;
                case 'complaint':
                  emoji = '⚠️';
                  title = 'Customer Complaint';
                  break;
                case 'reservation_change':
                  emoji = '🔄';
                  title = 'Reservation Change Request';
                  break;
                case 'cancellation':
                  emoji = '❌';
                  title = 'Cancellation Request';
                  break;
                case 'vip_info':
                  emoji = '⭐';
                  title = 'VIP Customer Alert';
                  break;
              }
              
              const priorityText = args.priority === 'urgent' ? ' [URGENT]' : '';
              
              const message = `${emoji} ${title}${priorityText}

Customer: ${conversation.customer_name || 'Unknown'}
Phone: ${customerPhone}

${args.summary}

${args.details ? `Details: ${args.details}\n` : ''}
Time: ${new Date().toLocaleString('en-US', { timeZone: 'Africa/Lusaka' })}`;

              // Send notification via Twilio
              const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID');
              const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN');
              
              if (!twilioSid || !twilioToken) {
                console.error('[BACKGROUND] Twilio credentials not configured');
                toolExecutionContext.push('boss notification failed - no twilio config');
              } else {
                // Get boss phone
                const bossPhone = company.boss_phone;
                if (!bossPhone) {
                  console.log('[BACKGROUND] No boss phone configured');
                  toolExecutionContext.push('boss notification skipped - no phone');
                } else {
                  const twilioResponse = await fetch(
                    `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
                    {
                      method: 'POST',
                      headers: {
                        'Authorization': 'Basic ' + btoa(`${twilioSid}:${twilioToken}`),
                        'Content-Type': 'application/x-www-form-urlencoded',
                      },
                      body: new URLSearchParams({
                        To: bossPhone.startsWith('whatsapp:') ? bossPhone : `whatsapp:${bossPhone}`,
                        From: `whatsapp:${company.whatsapp_number || Deno.env.get('TWILIO_WHATSAPP_NUMBER') || '+13344685065'}`,
                        Body: message,
                      }),
                    }
                  );

                  if (!twilioResponse.ok) {
                    const errorText = await twilioResponse.text();
                    console.error('[BACKGROUND] Twilio error:', errorText);
                    toolExecutionContext.push('boss notification failed - twilio error');
                  } else {
                    anyToolExecuted = true;
                    toolExecutionContext.push(`boss notified: ${args.notification_type}`);
                    console.log('[BACKGROUND] Boss notification sent successfully');
                    
                    // Log to boss_conversations
                    await supabase
                      .from('boss_conversations')
                      .insert({
                        company_id: company.id,
                        message_from: 'ai',
                        message_content: message,
                        response: null
                      });
                  }
                }
              }
            } catch (error) {
              console.error('[BACKGROUND] Exception in notify_boss:', error);
              toolExecutionContext.push('boss notification exception');
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

    // CRITICAL: If tools were executed, make SECOND AI call to process results
    if (toolResults.length > 0) {
      console.log('[TOOL-LOOP] Tools executed, making second AI call with results:', {
        toolCount: toolResults.length,
        results: toolResults.map(r => ({ id: r.tool_call_id, content: r.content.substring(0, 100) }))
      });
      
      try {
        // Build messages array with tool results
        const messagesWithToolResults = [
          ...messages,
          {
            role: "assistant",
            content: null,
            tool_calls: aiData.choices[0].message.tool_calls
          },
          ...toolResults
        ];
        
        console.log('[TOOL-LOOP] Calling AI with tool results...');
        
        // Check if this is a reservation flow and add validation reminder
        const isReservationFlow = messages.some(msg => 
          msg.content && typeof msg.content === 'string' && 
          (msg.content.toLowerCase().includes('reservation') || 
           msg.content.toLowerCase().includes('booking') || 
           msg.content.toLowerCase().includes('table') ||
           msg.content.toLowerCase().includes('meeting'))
        );
        
        if (isReservationFlow) {
          console.log('[RESERVATION-CHECK] Detected reservation flow, adding validation reminder');
          messagesWithToolResults.push({
            role: "system",
            content: `CRITICAL REMINDER: If customer just provided name/email/guests, CHECK if you now have all 6 required items (name, email, guests, phone, date, time). If ALL 6 present → IMMEDIATELY call create_reservation tool. If any missing → Ask for specific missing items only. DO NOT say "processed" or "done" without calling the tool.`
          });
        }
        
        const secondController = new AbortController();
        const secondTimeoutId = setTimeout(() => secondController.abort(), 60000);
        
        const secondResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          signal: secondController.signal,
          body: JSON.stringify({
            model: selectedModel,
            messages: messagesWithToolResults,
            temperature: 1.0,
            max_tokens: 2048
          }),
        });
        
        clearTimeout(secondTimeoutId);
        
        if (secondResponse.ok) {
          const secondData = await secondResponse.json();
          assistantReply = secondData.choices[0].message.content || '';
          console.log('[TOOL-LOOP] Second AI call successful, got natural response');
          
          // Check if AI wants to call MORE tools (recursive case)
          const newToolCalls = secondData.choices[0].message.tool_calls;
          if (newToolCalls && newToolCalls.length > 0) {
            console.log('[TOOL-LOOP] AI requesting additional tools:', newToolCalls.map((t: any) => t.function.name));
            // For now, we'll limit to 2 rounds to prevent infinite loops
            assistantReply = assistantReply || "I'm processing your request. One moment please...";
          }
        } else {
          console.error('[TOOL-LOOP] Second AI call failed:', secondResponse.status);
          assistantReply = "I processed your request. How else can I help you?";
        }
        
      } catch (toolLoopError) {
        console.error('[TOOL-LOOP] Error in second AI call:', toolLoopError);
        assistantReply = "Got it! What else can I help you with?";
      }
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

    // === CHECK FOR ONBOARDING KEYWORDS ===
    const onboardingKeywords = ['ONBOARD', 'SETUP', 'REGISTER', 'START SETUP', 'NEW COMPANY'];
    const isOnboardingRequest = onboardingKeywords.some(keyword => 
      Body.trim().toUpperCase().includes(keyword)
    );

    if (isOnboardingRequest) {
      console.log('[ONBOARDING] Detected onboarding keyword, redirecting to onboarding flow');
      
      const customerPhone = From.replace('whatsapp:', '');
      
      // Call onboarding function
      try {
        const onboardingResponse = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/whatsapp-onboarding`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              phone: customerPhone,
              message: Body
            }),
          }
        );

        const onboardingResult = await onboardingResponse.json();
        
        // Return TwiML response with onboarding message
        return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><![CDATA[${onboardingResult.response || 'Onboarding started!'}]]></Message>
</Response>`, {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' }
        });
      } catch (onboardingError) {
        console.error('[ONBOARDING] Error calling onboarding function:', onboardingError);
        // Continue with regular message processing if onboarding fails
      }
    }

    // === REGULAR MESSAGE PROCESSING BELOW ===

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
      
      // Check if message contains reservation command (APPROVE/REJECT/SUGGEST)
      const upperBody = Body.toUpperCase();
      if (upperBody.includes('APPROVE') || upperBody.includes('REJECT') || upperBody.includes('SUGGEST')) {
        console.log('[BOSS-WEBHOOK] Boss reservation command detected, routing to handler');
        
        // @ts-ignore - EdgeRuntime is a Deno Deploy global
        EdgeRuntime.waitUntil(
          (async () => {
            try {
              const { data: responseData, error: responseError } = await supabase.functions.invoke('handle-boss-response', {
                body: {
                  bossPhone: From,
                  messageBody: Body,
                  companyId: company.id
                }
              });
              
              if (responseError) {
                console.error('[BOSS-WEBHOOK] Error handling boss response:', responseError);
              } else {
                console.log('[BOSS-WEBHOOK] Boss response handled successfully');
              }
            } catch (error) {
              console.error('[BOSS-WEBHOOK] Exception handling boss response:', error);
            }
          })()
        );
        
        // Return empty TwiML - customer already notified by handler
        return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>`, {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/xml; charset=utf-8' }
        });
      }
      
      // Store boss message in database (for non-unmute, non-reservation messages)
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
