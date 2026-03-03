import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { company_id, message, conversation_history } = await req.json();

    if (!company_id || !message) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch company data
    const { data: company } = await supabase
      .from('companies')
      .select('*')
      .eq('id', company_id)
      .single();

    if (!company) {
      return new Response(JSON.stringify({ error: 'Company not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch current AI configuration
    const { data: aiOverrides } = await supabase
      .from('company_ai_overrides')
      .select('*')
      .eq('company_id', company_id)
      .maybeSingle();

    // Fetch current knowledge base docs
    const { data: documents } = await supabase
      .from('company_documents')
      .select('filename, parsed_content')
      .eq('company_id', company_id);

    let knowledgeBase = company.quick_reference_info || '';
    if (documents && documents.length > 0) {
      knowledgeBase += '\n\nUploaded Documents:\n';
      documents.forEach((doc: { filename: string; parsed_content: string | null }) => {
        if (doc.parsed_content) {
          knowledgeBase += `- ${doc.filename} (${doc.parsed_content.length} chars)\n`;
        }
      });
    }

    const systemPrompt = `You are an AI Training Coach for "${company.name}" — a ${company.business_type || 'business'} in Zambia.

Your role is to have a natural, collegial conversation with the business owner/admin about HOW the AI should handle customer interactions. You're like a smart colleague who helps them think through their customer service strategy.

CURRENT AI CONFIGURATION (what's already set up):
- System Instructions: ${aiOverrides?.system_instructions || '(none set)'}
- Q&A Style: ${aiOverrides?.qa_style || '(none set)'}
- Banned Topics: ${aiOverrides?.banned_topics || '(none set)'}
- Knowledge Base: ${knowledgeBase ? `${knowledgeBase.length} chars loaded` : '(empty)'}
- Business Hours: ${company.hours || 'Not set'}
- Services: ${company.services || 'Not set'}
- Currency: ${company.currency_prefix || 'K'}

YOUR CONVERSATION STYLE:
1. Be warm, professional, and conversational — like a colleague brainstorming over coffee
2. Ask probing questions to understand their business deeply
3. Suggest specific scenarios and ask "How should the AI handle this?"
4. Give concrete examples of good vs bad AI responses
5. When they describe a behavior, propose exact wording the AI could use
6. Proactively think of edge cases: "What if a customer asks about X?"
7. After discussing a topic, summarize what you've agreed on

THINGS TO EXPLORE WITH THE ADMIN:
- Greeting style and tone (formal vs casual, Zambian English nuances)
- How to handle complaints and angry customers
- Upselling and cross-selling strategies
- What to do when the AI doesn't know the answer
- Payment-related conversations
- Booking/reservation edge cases
- Common customer questions they get
- Things the AI should NEVER say or do
- How to handle competitors being mentioned
- After-hours inquiries
- VIP customer treatment
- Discount/promotion policies

IMPORTANT RULES:
- Don't just accept what they say — challenge them constructively: "That makes sense, but what about this scenario...?"
- After a good discussion point, offer to formulate it as a specific instruction they can add to the AI's training
- Use bullet points and clear formatting when summarizing agreed behaviors
- If they mention something that should go in the Knowledge Base vs System Instructions vs Q&A Style, guide them on where to put it
- Reference their actual business type and context naturally
- Keep responses focused — don't overwhelm with too many questions at once (1-2 per message)

START by warmly greeting them and asking about a specific aspect of their customer interactions you'd like to improve, based on their business type.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(conversation_history || []),
      { role: 'user', content: message }
    ];

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages,
        temperature: 0.8,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI API error:', errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again shortly.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: 'Credits exhausted. Please top up.' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      return new Response(JSON.stringify({ error: 'AI service error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiData = await response.json();
    const assistantMessage = aiData.choices?.[0]?.message?.content || 'No response generated';

    return new Response(JSON.stringify({ response: assistantMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Training coach error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
