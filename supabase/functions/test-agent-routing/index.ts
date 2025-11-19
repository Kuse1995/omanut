import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Supervisor Agent: Routes incoming messages to appropriate specialized agent
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message, conversationHistory = [] } = await req.json();

    if (!message) {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[TEST] Testing agent routing for message:', message);

    // Route the message
    const routingResult = await routeToAgent(message, conversationHistory);

    console.log('[TEST] Routing result:', routingResult);

    // Return the result
    return new Response(
      JSON.stringify({
        success: true,
        message: message,
        routing: routingResult,
        timestamp: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[TEST] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
