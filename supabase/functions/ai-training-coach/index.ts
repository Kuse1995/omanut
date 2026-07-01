import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChat, PRIMARY_TEXT_MODEL } from "../_shared/gemini-client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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
  },
  {
    type: "function",
    function: {
      name: "set_business_objectives",
      description: "Save the business owner's stated OBJECTIVES for what they want the AI to achieve (e.g. increase reservations 20%, reduce complaint response time, upsell drinks with meals). Call this AS SOON as the admin has stated one or more concrete objectives — even if only one is agreed. These objectives become the AI's north star for every downstream customer interaction.",
      parameters: {
        type: "object",
        properties: {
          objectives: {
            type: "array",
            description: "Ordered list of concrete, measurable objectives the AI should optimize for.",
            items: {
              type: "object",
              properties: {
                goal: { type: "string", description: "One-line objective (e.g. 'Convert 30% of WhatsApp inquiries into bookings')." },
                success_metric: { type: "string", description: "How success will be measured (e.g. 'weekly bookings from WhatsApp')." },
                priority: { type: "string", enum: ["high", "medium", "low"] }
              },
              required: ["goal"]
            }
          },
          summary: { type: "string", description: "One-line summary shown to the user." }
        },
        required: ["objectives", "summary"],
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

  if (toolName === 'set_business_objectives') {
    const { objectives, summary } = args;
    const formatted = '=== BUSINESS OBJECTIVES (AI north-star) ===\n' +
      (objectives as any[]).map((o, i) =>
        `${i + 1}. [${(o.priority || 'medium').toUpperCase()}] ${o.goal}${o.success_metric ? ` — measured by: ${o.success_metric}` : ''}`
      ).join('\n');

    const { data: overrides } = await supabase
      .from('company_ai_overrides')
      .select('system_instructions')
      .eq('company_id', companyId)
      .maybeSingle();

    const existing = (overrides?.system_instructions || '').replace(/=== BUSINESS OBJECTIVES \(AI north-star\) ===[\s\S]*?(?=\n===|$)/g, '').trim();
    const updated = existing ? `${formatted}\n\n${existing}` : formatted;

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
    return { success: true, target: 'Business Objectives', summary };
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

    const hasObjectives = /=== BUSINESS OBJECTIVES/i.test(aiOverrides?.system_instructions || '');

    const systemPrompt = `You are the AI Training Coach for "${company.name}" — a ${company.business_type || 'business'} in Zambia.

Your job is to make sure this company's AI assistant is aimed at real business goals, not just generic "be helpful" politeness.

CURRENT AI CONFIGURATION:
- Objectives set?: ${hasObjectives ? 'YES ✅' : 'NO ❌ — you MUST elicit them first'}
- System Instructions: ${aiOverrides?.system_instructions || '(none set)'}
- Q&A Style: ${aiOverrides?.qa_style || '(none set)'}
- Banned Topics: ${aiOverrides?.banned_topics || '(none set)'}
- Knowledge Base: ${knowledgeBase ? `${knowledgeBase.substring(0, 500)}${knowledgeBase.length > 500 ? '...' : ''}` : '(empty)'}
- Business Hours: ${company.hours || 'Not set'}
- Services: ${company.services || 'Not set'}
- Currency: ${company.currency_prefix || 'K'}

═══════════════════════════════════════════════════════
🎯 OBJECTIVES-FIRST PROTOCOL (NON-NEGOTIABLE)
═══════════════════════════════════════════════════════
Before you help configure ANY behaviour, tone, banned topic or knowledge item, you MUST establish what the owner is actually trying to achieve with the AI. This is the anchor for every downstream decision.

${hasObjectives
  ? 'Objectives are already on file. Confirm they are still current, then help refine or add to them, and use them to justify every suggestion you make ("Given your objective X, I recommend ...").'
  : `NO OBJECTIVES ARE SAVED YET. Your FIRST message must:
1. Warmly greet the owner by their business name.
2. Explain in 1-2 sentences: "Before we tune anything, I need to know what you want this AI to actually achieve for ${company.name}."
3. Ask them to name 1–3 concrete goals. Give examples tailored to their business type (e.g. "increase weekend bookings", "recover abandoned carts within 24h", "cut response time on complaints").
4. DO NOT ask about tone, greetings, banned topics or edge cases yet — those come AFTER objectives.
5. As soon as they name concrete objectives (even one), call the "set_business_objectives" tool to save them, then reflect them back and ask which one to work on first.`}

Once objectives are locked in, every subsequent suggestion you make must explicitly reference which objective it serves. Example: "To support your objective of increasing reservations, I recommend the AI greets returning customers by name — shall I save that?"

═══════════════════════════════════════════════════════
CONVERSATION STYLE
═══════════════════════════════════════════════════════
- Warm, collegial, focused. Like a strategist over coffee, not a form.
- 1–2 questions per message MAX.
- Give concrete example wording ("The AI would say: '...'") so the owner can react.
- Think of edge cases proactively, but only after objectives exist.

═══════════════════════════════════════════════════════
AUTO-SAVE RULES (call tools the moment agreement is reached)
═══════════════════════════════════════════════════════
- set_business_objectives  → whenever the owner states/refines goals (call EARLY and OFTEN).
- append_to_knowledge_base  → facts: prices, products, hours, policies, FAQs.
- append_to_system_instructions → behavioural rules: greetings, complaint handling, escalation, what to never say.
- append_to_qa_style → tone/style: formality, length, language mix.
- append_to_banned_topics → topics to avoid.
Rules:
- Save only what the owner CONFIRMED. Never save speculation.
- After saving, tell them exactly what was saved and where ("✅ Saved to Business Objectives").
- Don't duplicate — the current config is shown above.
- Format saved content cleanly (headers, bullets).

TOPICS TO EXPLORE (AFTER objectives are set):
Greeting style · Complaint handling · Upselling · Unknown-answer fallback · Payment conversations · Booking edge cases · Common questions · Never-say list · Competitor mentions · After-hours · VIP treatment · Discount policy.

${hasObjectives ? 'Continue the conversation naturally.' : 'START NOW: greet them and ask for their objectives. Nothing else.'}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(conversation_history || []),
      { role: 'user', content: message }
    ];

    // First AI call
    const firstResponse = await geminiChat({
      model: PRIMARY_TEXT_MODEL,
      messages,
      temperature: 0.8,
      max_tokens: 1024,
      tools,
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

    const secondResponse = await geminiChat({
      model: PRIMARY_TEXT_MODEL,
      messages: secondMessages,
      temperature: 0.8,
      max_tokens: 1024,
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
      error: 'An error occurred processing your request'
    }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
