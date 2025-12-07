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

    const { company_id, mode, message, conversation_history } = await req.json();

    if (!company_id || !message) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch company data
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('*')
      .eq('id', company_id)
      .single();

    if (companyError || !company) {
      return new Response(JSON.stringify({ error: 'Company not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch AI overrides
    const { data: aiOverrides } = await supabase
      .from('company_ai_overrides')
      .select('*')
      .eq('company_id', company_id)
      .single();

    // Fetch documents for knowledge base
    const { data: documents } = await supabase
      .from('company_documents')
      .select('filename, parsed_content')
      .eq('company_id', company_id);

    // Build knowledge base context
    let knowledgeBase = company.quick_reference_info || '';
    if (documents && documents.length > 0) {
      knowledgeBase += '\n\nDocument Library:\n';
      documents.forEach((doc: { filename: string; parsed_content: string | null }) => {
        if (doc.parsed_content) {
          knowledgeBase += `\n--- ${doc.filename} ---\n${doc.parsed_content}\n`;
        }
      });
    }

    // Build system prompt based on mode
    let systemPrompt = '';
    const currentDate = new Date().toLocaleString('en-ZM', { timeZone: 'Africa/Lusaka' });

    if (mode === 'customer') {
      systemPrompt = `You are an AI assistant for ${company.name}. Current date/time: ${currentDate}

Business Information:
- Type: ${company.business_type || 'General Business'}
- Hours: ${company.hours || 'Not specified'}
- Services: ${company.services || 'Not specified'}
- Currency: ${company.currency_prefix || 'K'}

${aiOverrides?.system_instructions ? `Custom Instructions:\n${aiOverrides.system_instructions}\n` : ''}
${aiOverrides?.qa_style ? `Response Style:\n${aiOverrides.qa_style}\n` : ''}
${aiOverrides?.banned_topics ? `Topics to Avoid:\n${aiOverrides.banned_topics}\n` : ''}

Knowledge Base:
${knowledgeBase}

Respond as you would to a real customer. Be helpful, professional, and follow the company's guidelines.`;
    } else if (mode === 'boss') {
      systemPrompt = `You are an AI business advisor for ${company.name}. Current date/time: ${currentDate}

You're speaking with the business owner/manager. Provide strategic insights, sales advice, and operational guidance.

Business Information:
- Type: ${company.business_type || 'General Business'}
- Hours: ${company.hours || 'Not specified'}
- Services: ${company.services || 'Not specified'}

Knowledge Base:
${knowledgeBase}

Provide direct, professional advice as a head of sales and marketing advisor.`;
    } else {
      // Training mode
      systemPrompt = `You are in TRAINING MODE for ${company.name}. Current date/time: ${currentDate}

The admin is teaching you new behaviors or testing responses. Pay close attention to their instructions and feedback.

Current Configuration:
- System Instructions: ${aiOverrides?.system_instructions || 'None set'}
- Q&A Style: ${aiOverrides?.qa_style || 'None set'}
- Banned Topics: ${aiOverrides?.banned_topics || 'None set'}

Knowledge Base:
${knowledgeBase}

Acknowledge training inputs and demonstrate how you would apply them.`;
    }

    // Build messages array
    const messages = [
      { role: 'system', content: systemPrompt },
      ...(conversation_history || []),
      { role: 'user', content: message }
    ];

    // Call Lovable AI
    const startTime = Date.now();
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages,
        temperature: 0.7,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', errorText);
      return new Response(JSON.stringify({ error: 'AI service error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiData = await aiResponse.json();
    const responseTime = Date.now() - startTime;
    const assistantMessage = aiData.choices?.[0]?.message?.content || 'No response generated';

    // Build analysis/reasoning info
    const analysis = {
      mode,
      response_time_ms: responseTime,
      model_used: 'google/gemini-2.5-flash',
      tokens_used: aiData.usage?.total_tokens || 0,
      system_prompt_length: systemPrompt.length,
      knowledge_base_loaded: knowledgeBase.length > 0,
      ai_overrides_applied: {
        system_instructions: !!aiOverrides?.system_instructions,
        qa_style: !!aiOverrides?.qa_style,
        banned_topics: !!aiOverrides?.banned_topics,
      },
    };

    return new Response(JSON.stringify({
      response: assistantMessage,
      analysis,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Playground error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
