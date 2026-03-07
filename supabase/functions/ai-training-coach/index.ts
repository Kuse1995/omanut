import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChat } from "../_shared/gemini-client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const tools = [
  {
    type: "function",
    function: {
      name: "append_to_knowledge_base",
      description: "Append agreed-upon business information (products, prices, policies, FAQs, hours, etc.) to the company's Knowledge Base. Use this when you and the admin agree on factual business data the AI should know.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The formatted content to append to the knowledge base. Use clear headers and bullet points."
          },
          summary: {
            type: "string",
            description: "A brief 1-line summary of what was added (shown to the user as a notification)"
          }
        },
        required: ["content", "summary"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "append_to_system_instructions",
      description: "Append agreed-upon behavioral rules and directives to the AI's System Instructions. Use this for HOW the AI should behave — tone, escalation rules, greeting style, complaint handling, things to never say, etc.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The behavioral instruction to append. Be specific and actionable."
          },
          summary: {
            type: "string",
            description: "A brief 1-line summary of the instruction added (shown to the user)"
          }
        },
        required: ["content", "summary"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "append_to_qa_style",
      description: "Append agreed-upon response style and tone guidelines to Q&A Style. Use this for tone preferences, language style, formality level, response patterns.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The style/tone guideline to append."
          },
          summary: {
            type: "string",
            description: "A brief 1-line summary of the style added"
          }
        },
        required: ["content", "summary"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "append_to_banned_topics",
      description: "Add topics the AI should never discuss to the Banned Topics list. Use when the admin agrees certain topics should be off-limits.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The banned topic(s) to add."
          },
          summary: {
            type: "string",
            description: "A brief 1-line summary"
          }
        },
        required: ["content", "summary"],
        additionalProperties: false
      }
    }
  }
];

async function executeTool(
  supabase: any,
  companyId: string,
  toolName: string,
  args: any
): Promise<{ success: boolean; target: string; summary: string }> {
  const { content, summary } = args;

  if (toolName === 'append_to_knowledge_base') {
    const { data: company } = await supabase
      .from('companies')
      .select('quick_reference_info')
      .eq('id', companyId)
      .single();

    const existing = company?.quick_reference_info || '';
    const updated = existing
      ? `${existing}\n\n${content}`
      : content;

    const { error } = await supabase
      .from('companies')
      .update({ quick_reference_info: updated })
      .eq('id', companyId);

    if (error) throw error;
    return { success: true, target: 'Knowledge Base', summary };
  }

  if (toolName === 'append_to_system_instructions') {
    const { data: overrides } = await supabase
      .from('company_ai_overrides')
      .select('system_instructions')
      .eq('company_id', companyId)
      .maybeSingle();

    const existing = overrides?.system_instructions || '';
    const updated = existing ? `${existing}\n\n${content}` : content;

    if (overrides) {
      const { error } = await supabase
        .from('company_ai_overrides')
        .update({ system_instructions: updated })
        .eq('company_id', companyId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('company_ai_overrides')
        .insert({ company_id: companyId, system_instructions: updated });
      if (error) throw error;
    }
    return { success: true, target: 'System Instructions', summary };
  }

  if (toolName === 'append_to_qa_style') {
    const { data: overrides } = await supabase
      .from('company_ai_overrides')
      .select('qa_style')
      .eq('company_id', companyId)
      .maybeSingle();

    const existing = overrides?.qa_style || '';
    const updated = existing ? `${existing}\n\n${content}` : content;

    if (overrides) {
      const { error } = await supabase
        .from('company_ai_overrides')
        .update({ qa_style: updated })
        .eq('company_id', companyId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('company_ai_overrides')
        .insert({ company_id: companyId, qa_style: updated });
      if (error) throw error;
    }
    return { success: true, target: 'Q&A Style', summary };
  }

  if (toolName === 'append_to_banned_topics') {
    const { data: overrides } = await supabase
      .from('company_ai_overrides')
      .select('banned_topics')
      .eq('company_id', companyId)
      .maybeSingle();

    const existing = overrides?.banned_topics || '';
    const updated = existing ? `${existing}\n${content}` : content;

    if (overrides) {
      const { error } = await supabase
        .from('company_ai_overrides')
        .update({ banned_topics: updated })
        .eq('company_id', companyId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('company_ai_overrides')
        .insert({ company_id: companyId, banned_topics: updated });
      if (error) throw error;
    }
    return { success: true, target: 'Banned Topics', summary };
  }

  return { success: false, target: 'unknown', summary: 'Unknown tool' };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { company_id, message, conversation_history } = await req.json();
    if (!company_id || !message) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch company + overrides + docs
    const [companyRes, overridesRes, docsRes] = await Promise.all([
      supabase.from('companies').select('*').eq('id', company_id).single(),
      supabase.from('company_ai_overrides').select('*').eq('company_id', company_id).maybeSingle(),
      supabase.from('company_documents').select('filename, parsed_content').eq('company_id', company_id),
    ]);

    const company = companyRes.data;
    if (!company) {
      return new Response(JSON.stringify({ error: 'Company not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiOverrides = overridesRes.data;
    const documents = docsRes.data;

    let knowledgeBase = company.quick_reference_info || '';
    if (documents && documents.length > 0) {
      knowledgeBase += '\n\nUploaded Documents:\n';
      documents.forEach((doc: { filename: string; parsed_content: string | null }) => {
        if (doc.parsed_content) knowledgeBase += `- ${doc.filename} (${doc.parsed_content.length} chars)\n`;
      });
    }

    const systemPrompt = `You are an AI Training Coach for "${company.name}" — a ${company.business_type || 'business'} in Zambia.

Your role is to have a natural, collegial conversation with the business owner/admin about HOW the AI should handle customer interactions.

CURRENT AI CONFIGURATION:
- System Instructions: ${aiOverrides?.system_instructions || '(none set)'}
- Q&A Style: ${aiOverrides?.qa_style || '(none set)'}
- Banned Topics: ${aiOverrides?.banned_topics || '(none set)'}
- Knowledge Base: ${knowledgeBase ? `${knowledgeBase.substring(0, 500)}${knowledgeBase.length > 500 ? '...' : ''}` : '(empty)'}
- Business Hours: ${company.hours || 'Not set'}
- Services: ${company.services || 'Not set'}
- Currency: ${company.currency_prefix || 'K'}

YOUR CONVERSATION STYLE:
1. Be warm, professional, conversational — like a colleague brainstorming over coffee
2. Ask probing questions to understand their business deeply
3. Suggest specific scenarios: "How should the AI handle this?"
4. Give concrete examples of good vs bad responses
5. Propose exact wording the AI could use
6. Think of edge cases proactively
7. Keep responses focused — 1-2 questions per message max

CRITICAL: AUTO-SAVING RULES
You have tools to save agreed-upon content. Use them as follows:
- When the admin CONFIRMS or AGREES to a specific behavior, instruction, or piece of info — SAVE IT IMMEDIATELY using the appropriate tool
- Use "append_to_knowledge_base" for factual data: prices, products, hours, policies, FAQs
- Use "append_to_system_instructions" for behavioral rules: how to greet, handle complaints, escalation, what to never say
- Use "append_to_qa_style" for tone/style: formal vs casual, language style, response length
- Use "append_to_banned_topics" for topics to avoid
- DO NOT save things the admin is still considering or hasn't agreed to
- After saving, tell the admin what you saved and where (e.g. "✅ I've added that greeting style to your System Instructions")
- Format saved content cleanly with headers and bullet points
- Don't save duplicates — check the current configuration first

TOPICS TO EXPLORE:
- Greeting style and tone
- Complaint handling
- Upselling strategies
- Unknown answer fallback
- Payment conversations
- Booking edge cases
- Common customer questions
- Things the AI should NEVER say
- Competitor mentions
- After-hours inquiries
- VIP customer treatment
- Discount/promotion policies

START by warmly greeting them and asking about a specific aspect of their customer interactions.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(conversation_history || []),
      { role: 'user', content: message }
    ];

    // First AI call
    const firstResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
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
        tools,
      }),
    });

    if (!firstResponse.ok) {
      const errorText = await firstResponse.text();
      console.error('AI API error:', errorText);
      if (firstResponse.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again shortly.' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (firstResponse.status === 402) {
        return new Response(JSON.stringify({ error: 'Credits exhausted. Please top up.' }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'AI service error' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const firstData = await firstResponse.json();
    const firstChoice = firstData.choices?.[0];
    const toolCalls = firstChoice?.message?.tool_calls;
    const savedItems: Array<{ target: string; summary: string }> = [];

    // If no tool calls, return directly
    if (!toolCalls || toolCalls.length === 0) {
      const assistantMessage = firstChoice?.message?.content || 'No response generated';
      return new Response(JSON.stringify({ response: assistantMessage, saved: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Execute tool calls
    const toolResults = [];
    for (const tc of toolCalls) {
      try {
        const args = JSON.parse(tc.function.arguments);
        const result = await executeTool(supabase, company_id, tc.function.name, args);
        savedItems.push({ target: result.target, summary: result.summary });
        toolResults.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      } catch (err) {
        console.error('Tool execution error:', err);
        toolResults.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify({ success: false, error: String(err) }),
        });
      }
    }

    // Second AI call with tool results
    const secondMessages = [
      ...messages,
      firstChoice.message,
      ...toolResults,
    ];

    const secondResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: secondMessages,
        temperature: 0.8,
        max_tokens: 1024,
      }),
    });

    if (!secondResponse.ok) {
      // Fallback: return first response content if available
      const fallback = firstChoice?.message?.content || 'Changes saved successfully.';
      return new Response(JSON.stringify({ response: fallback, saved: savedItems }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const secondData = await secondResponse.json();
    const finalMessage = secondData.choices?.[0]?.message?.content || 'Changes saved successfully.';

    return new Response(JSON.stringify({ response: finalMessage, saved: savedItems }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Training coach error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
