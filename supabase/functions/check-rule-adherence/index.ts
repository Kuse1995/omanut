// Post-response critic. Loads the assistant message + custom instructions +
// banned topics, asks a light model to score adherence, logs violations.
// Fire-and-forget: does NOT retry or block the user reply.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { geminiChat } from '../_shared/gemini-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM = `You are a strict compliance auditor for a business AI assistant.
You are given:
- CUSTOM_INSTRUCTIONS the business owner set (must be obeyed literally)
- BANNED_TOPICS the AI must never discuss
- The last USER message and the AI's ASSISTANT reply

Score adherence and return STRICT JSON only:
{
  "passed": boolean,
  "severity": "low" | "medium" | "high",
  "violations": [
    { "rule_broken": "short label", "explanation": "1 sentence", "offending_excerpt": "quote from reply" }
  ]
}

Rules:
- passed=true only if reply violates NOTHING in CUSTOM_INSTRUCTIONS or BANNED_TOPICS.
- Discussing a banned topic = severity "high".
- Fabricating a price/stock/policy not in the instructions = "high".
- Wrong tone or ignored formatting rule = "medium".
- Minor style drift = "low".
- If no violations, return {"passed": true, "severity": "low", "violations": []}.
- Do NOT invent violations. Be conservative. Output JSON only.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { message_id } = await req.json();
    if (!message_id) return json({ error: 'message_id required' }, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Load message + conversation
    const { data: msg, error: mErr } = await supabase
      .from('messages')
      .select('id, conversation_id, role, content, created_at')
      .eq('id', message_id)
      .maybeSingle();
    if (mErr || !msg) return json({ error: 'message not found' }, 404);
    if (msg.role !== 'assistant') return json({ skipped: 'not assistant' });

    const { data: conv } = await supabase
      .from('conversations')
      .select('id, company_id, channel')
      .eq('id', msg.conversation_id)
      .maybeSingle();
    if (!conv) return json({ skipped: 'no conversation' });

    // Only enforce on WhatsApp + Meta DMs (per user's scope)
    const channel = (conv.channel || 'whatsapp').toLowerCase();
    if (!['whatsapp', 'meta_dm', 'facebook', 'instagram', 'facebook_dm', 'instagram_dm'].includes(channel)) {
      return json({ skipped: 'out of scope', channel });
    }

    // Last user message right before this assistant reply
    const { data: prev } = await supabase
      .from('messages')
      .select('role, content, created_at')
      .eq('conversation_id', msg.conversation_id)
      .lt('created_at', msg.created_at)
      .order('created_at', { ascending: false })
      .limit(1);
    const lastUser = prev?.[0]?.role === 'user' ? prev[0].content : '';

    // Custom instructions
    const { data: ov } = await supabase
      .from('company_ai_overrides')
      .select('system_instructions, banned_topics, qa_style')
      .eq('company_id', conv.company_id)
      .maybeSingle();

    const customInstructions = (ov?.system_instructions || '').trim();
    const bannedTopics = (ov?.banned_topics || '').trim();
    const qaStyle = (ov?.qa_style || '').trim();

    // Nothing configured → nothing to audit.
    if (!customInstructions && !bannedTopics && !qaStyle) {
      return json({ skipped: 'no custom rules configured' });
    }

    const userMsg = `CUSTOM_INSTRUCTIONS:
${customInstructions || '(none)'}

BANNED_TOPICS:
${bannedTopics || '(none)'}

TONE / STYLE:
${qaStyle || '(none)'}

USER:
"""${lastUser || '(no prior user message)'}"""

ASSISTANT REPLY TO AUDIT:
"""${msg.content}"""

Output JSON only.`;

    const model = 'google/gemini-2.5-flash-lite';
    const resp = await geminiChat({
      model,
      temperature: 0,
      max_tokens: 500,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userMsg },
      ],
    });
    if (!resp.ok) {
      console.error('[rule-critic] model call failed', resp.status, await resp.text().catch(() => ''));
      return json({ error: 'critic failed' }, 200);
    }
    const data = await resp.json();
    const raw = (data.choices?.[0]?.message?.content || '').trim();
    const parsed = extractJson(raw);
    const violations = Array.isArray(parsed.violations) ? parsed.violations : [];
    const severity = ['low', 'medium', 'high'].includes(parsed.severity) ? parsed.severity : 'medium';

    if (!violations.length || parsed.passed === true) {
      return json({ passed: true, violations: 0 });
    }

    const rows = violations.slice(0, 5).map((v: any) => ({
      company_id: conv.company_id,
      conversation_id: conv.id,
      message_id: msg.id,
      channel,
      severity,
      rule_broken: String(v.rule_broken || 'unspecified').slice(0, 200),
      explanation: String(v.explanation || '').slice(0, 1000),
      offending_excerpt: String(v.offending_excerpt || '').slice(0, 500),
      assistant_content: msg.content.slice(0, 2000),
      model,
    }));

    const { error: iErr } = await supabase.from('rule_violations').insert(rows);
    if (iErr) console.error('[rule-critic] insert failed', iErr);

    return json({ passed: false, logged: rows.length, severity });
  } catch (e) {
    console.error('[rule-critic] error', e);
    return json({ error: 'internal' }, 200);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function extractJson(s: string): any {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : s;
  try { return JSON.parse(body); } catch { /* continue */ }
  const m = body.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* continue */ } }
  return {};
}
