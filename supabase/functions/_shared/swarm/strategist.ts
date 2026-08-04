// Strategist v2: decides the reply strategy - answer | qualify | close | redirect | escalate | decline.
// Deterministic pre-checks first (buy signals, loan queries, frustration, out-of-scope), then a
// cheap model-assisted decision for the ambiguous middle. Strict JSON, t=0.
import { geminiChatWithFallback, PRIMARY_TEXT_MODEL } from '../gemini-client.ts';
import type { Decision, IntentObject, RuleSet, SwarmInput, LeadTier } from './types.ts';

const BUY_RE = /\b(interested|i want|i need|how (much|do i|can i)|price|cost|pay|payment|buy|purchase|order|start|subscribe|sign ?up|yes|yeah|yup|ok|okay|ready|send (me )?(the )?link)\b/i;
const LOAN_RE = /\b(loan|loans|borrow|borrowing|lend|lending|credit|zamcash|zambucks|interest on)\b/i;
const FRUSTRATION_RE = /\b(not serious|are you (real|serious|a robot)|useless|stop (this|repeating)|stupid|help me please|anyone there)\b/i;
const OUT_OF_SCOPE_RE = /\b(boost (your|my) (facebook|page)|followers for sale|sell (you|me) |job application|apply for a job|work with us|partnership proposal)\b/i;

function detectBuySignal(intent: IntentObject, text: string): boolean {
  const asks = (intent.asks || []).join(' ').toLowerCase();
  const t = (text + ' ' + asks).toLowerCase();
  const hasIntent = /buy_signal|payment|price_check/.test(intent.intent_type);
  return hasIntent || BUY_RE.test(t);
}

function toLeadTier(v: unknown): LeadTier {
  const s = String(v || 'unknown').toLowerCase();
  return (['hot', 'warm', 'cold', 'unknown'].includes(s) ? s as LeadTier : 'unknown');
}

const SYSTEM = `You are the STRATEGIST of an AI agent swarm for an SME business assistant.
Decide how to handle this customer message. Return STRICT JSON only.

Schema:
{
  "action": "answer" | "qualify" | "close" | "redirect" | "escalate" | "decline",
  "reason": "one short sentence",
  "next_step": "what the reply must accomplish in one short phrase",
  "needs_boss": true | false,
  "lead_tier": "hot" | "warm" | "cold" | "unknown"
}

Guidance:
- answer: clear, factual question with facts available.
- qualify: vague interest - ask ONE question to surface the need, recommend nothing yet.
- close: strong buying signal, customer ready to buy/subscribe.
- redirect: loan/credit/zamcash confusion - politely clarify what the company does, no lending.
- escalate: complaint, frustration, repeated questions, 5+ messages with no progress, or you cannot answer confidently.
- decline: out-of-scope, spam, or someone selling TO the business.`;

function extractJson(s: string): any {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : s;
  try { return JSON.parse(body); } catch { /* continue */ }
  const m = body.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* continue */ } }
  return {};
}

export async function runStrategist(args: {
  input: SwarmInput;
  intent: IntentObject;
  rules: RuleSet;
}): Promise<{ decision: Decision; ms: number; model: string }> {
  const start = Date.now();
  const { input, intent, rules } = args;
  const text = (intent.cleaned_text || input.raw_text) + ' ' + (intent.asks || []).join(' ');

  // Deterministic paths first (fast, cheap, safe)
  if (LOAN_RE.test(text)) {
    return { decision: { action: 'redirect', reason: 'Loan/credit/zamcash query - clarify company scope, no lending.', next_step: 'Politely clarify the company does not lend money; state what it does; do not pitch.', needs_boss: false, lead_tier: intent.lead_tier }, ms: 0, model: 'deterministic' };
  }
  if (FRUSTRATION_RE.test(text) || intent.sentiment === 'urgent') {
    return { decision: { action: 'escalate', reason: 'Customer frustration or urgent sentiment detected.', next_step: 'Apologize sincerely, answer directly, and tell them the team is stepping in.', needs_boss: true, lead_tier: intent.lead_tier }, ms: 0, model: 'deterministic' };
  }
  if (OUT_OF_SCOPE_RE.test(text) || intent.intent_type === 'out_of_scope' || intent.intent_type === 'spam') {
    return { decision: { action: 'decline', reason: 'Out of scope or spam.', next_step: 'Politely decline and redirect to the business if relevant.', needs_boss: false, lead_tier: intent.lead_tier }, ms: 0, model: 'deterministic' };
  }
  if (intent.intent_type === 'loan') {
    return { decision: { action: 'redirect', reason: 'Loan intent.', next_step: 'Clarify company does not lend; no pitch.', needs_boss: false, lead_tier: intent.lead_tier }, ms: 0, model: 'deterministic' };
  }
  const historyLen = (input.history || []).filter((m) => m.role === 'user').length;
  if (historyLen >= 5 && ['negative', 'urgent'].includes(intent.sentiment)) {
    return { decision: { action: 'escalate', reason: '5+ messages with negative/urgent sentiment - KB escalation trigger.', next_step: 'Acknowledge, apologize, answer, and hand to the team.', needs_boss: true, lead_tier: intent.lead_tier }, ms: 0, model: 'deterministic' };
  }

  // Model-assisted decision
  const model = Deno.env.get('SWARM_STRATEGIST_MODEL') || PRIMARY_TEXT_MODEL;
  const userMsg = `CUSTOMER MESSAGE:
"""${input.raw_text}"""

INTENT:
${JSON.stringify(intent, null, 2)}

ESCALATION TRIGGERS (from company KB):
${(rules.escalation_triggers || []).map((t) => '- ' + t).join('\n') || '- none'}

Output JSON now.`;

  const resp = await geminiChatWithFallback({
    model,
    temperature: 0,
    max_tokens: 300,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userMsg },
    ],
  });
  if (!resp.ok) throw new Error('[Strategist] HTTP ' + resp.status);
  const data = await resp.json();
  const json = extractJson(data.choices?.[0]?.message?.content || '');
  const action = ['answer', 'qualify', 'close', 'redirect', 'escalate', 'decline'].includes(json.action) ? json.action : 'answer';

  // If the model missed an explicit buy signal, upgrade to close
  const finalAction = (action !== 'escalate' && detectBuySignal(intent, text) && intent.lead_tier !== 'cold') ? 'close' : action;

  const decision: Decision = {
    action: finalAction,
    reason: String(json.reason || '').slice(0, 200),
    next_step: String(json.next_step || '').slice(0, 200),
    needs_boss: finalAction === 'escalate' || json.needs_boss === true,
    lead_tier: toLeadTier(json.lead_tier) === 'unknown' ? intent.lead_tier : toLeadTier(json.lead_tier),
  };
  return { decision, ms: Date.now() - start, model };
}
