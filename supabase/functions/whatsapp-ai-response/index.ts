import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AIResponseRequest {
  conversationId: string;
  companyId: string;
  customerPhone: string;
  customerName?: string;
  message: string;
  messageType?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    const body: AIResponseRequest = await req.json();
    const { conversationId, companyId, customerPhone, customerName, message, messageType } = body;

    console.log('[AI-RESPONSE] Processing:', { conversationId, companyId, customerPhone });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Fetch company data and AI overrides
    const { data: company } = await supabase
      .from('companies')
      .select('*, company_ai_overrides(*)')
      .eq('id', companyId)
      .single();

    if (!company) {
      console.error('[AI-RESPONSE] Company not found:', companyId);
      return new Response(
        JSON.stringify({ error: 'Company not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiOverrides = company.company_ai_overrides;
    const primaryModel = aiOverrides?.primary_model || 'google/gemini-2.5-flash';
    const temperature = aiOverrides?.primary_temperature || 0.7;
    const maxTokens = aiOverrides?.max_tokens || 1024;

    // Fetch conversation history
    const { data: messages } = await supabase
      .from('messages')
      .select('role, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(20);

    // Build conversation context
    const conversationHistory = (messages || []).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content
    }));

    // Build system prompt
    const systemPrompt = buildSystemPrompt(company, aiOverrides);

    console.log('[AI-RESPONSE] Using model:', primaryModel, 'Temperature:', temperature);

    // Generate AI response using Lovable AI Gateway
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
    if (!LOVABLE_API_KEY) {
      console.error('[AI-RESPONSE] LOVABLE_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'AI not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: primaryModel,
        messages: [
          { role: 'system', content: systemPrompt },
          ...conversationHistory,
          { role: 'user', content: message }
        ],
        temperature,
        max_tokens: maxTokens
      })
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('[AI-RESPONSE] AI Gateway error:', errorText);
      
      // Send fallback message
      await sendFallbackMessage(customerPhone, companyId, supabase, conversationId);
      
      return new Response(
        JSON.stringify({ error: 'AI generation failed', sent: 'fallback' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await aiResponse.json();
    const generatedContent = aiData.choices?.[0]?.message?.content || '';

    if (!generatedContent) {
      console.error('[AI-RESPONSE] Empty AI response');
      await sendFallbackMessage(customerPhone, companyId, supabase, conversationId);
      return new Response(
        JSON.stringify({ error: 'Empty AI response', sent: 'fallback' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[AI-RESPONSE] Generated response:', generatedContent.substring(0, 100) + '...');

    // Send response via Meta WhatsApp API
    const sendResponse = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-whatsapp-meta`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
        },
        body: JSON.stringify({
          to: customerPhone,
          message: generatedContent,
          companyId,
          conversationId
        })
      }
    );

    const sendResult = await sendResponse.json();
    const processingTime = Date.now() - startTime;

    console.log('[AI-RESPONSE] Message sent in', processingTime, 'ms');

    // Update conversation
    await supabase
      .from('conversations')
      .update({
        last_message_preview: generatedContent.substring(0, 100),
        unread_count: 0
      })
      .eq('id', conversationId);

    return new Response(
      JSON.stringify({ 
        success: true, 
        messageId: sendResult.messageId,
        processingTime
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('[AI-RESPONSE] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function buildSystemPrompt(company: any, overrides: any): string {
  const basePrompt = overrides?.system_instructions || '';
  
  return `You are a helpful AI assistant for ${company.name}.

${basePrompt}

BUSINESS INFORMATION:
- Business Type: ${company.business_type || 'General Business'}
- Hours: ${company.hours || 'Contact for hours'}
- Services: ${company.services || 'Various services available'}
- Branches: ${company.branches || 'Main location'}
- Currency: ${company.currency_prefix || 'K'}

GUIDELINES:
- Be friendly, professional, and helpful
- Keep responses concise and relevant
- Use the business currency when mentioning prices
- If you don't know something, say so politely
- Never make up information about products, prices, or availability
${overrides?.qa_style || ''}

${overrides?.banned_topics ? `\nDO NOT discuss: ${overrides.banned_topics}` : ''}`;
}

async function sendFallbackMessage(
  customerPhone: string,
  companyId: string,
  supabase: any,
  conversationId: string
) {
  const fallbackMsg = "Thank you for your message. I'm experiencing a brief delay - someone will respond shortly. 🙏";
  
  try {
    await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-whatsapp-meta`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
        },
        body: JSON.stringify({
          to: customerPhone,
          message: fallbackMsg,
          companyId,
          conversationId
        })
      }
    );
    
    console.log('[AI-RESPONSE] Fallback message sent');
  } catch (error) {
    console.error('[AI-RESPONSE] Failed to send fallback:', error);
  }
}
