// Router v2: intent, language, sentiment, lead tier, agent mode. Strict JSON, t=0.
import { geminiChatWithFallback, PRIMARY_TEXT_MODEL } from '../gemini-client.ts';
import type { IntentObject, SwarmInput, LeadTier } from './types.ts';

const SYSTEM = `You are the ROUTER of an AI agent swarm for an African SME business assistant.
Your ONLY job is to classify the customer's message. You DO NOT answer the customer.
Return STRICT JSON only - no markdown, no prose.

Schema:
{
  "intent_type": "price_check" | "stock_check" | "product_question" | "buy_signal" | "payment" | "booking" |
                 "hours" | "location" | "support" | "account" | "complaint" | "refund" | "greeting" |
                 "small_talk" | "loan" | "out_of_scope" | "spam" | "unknown",
  "language": "en" | "en-ZM" | "fr" | "sw" | ...,
  "sentiment": "positive" | "neutral" | "negative" | "urgent",
  "entities": { "product"?, "qty"?, "amount"?, "date"?, "name"? },
  "cleaned_text": "typo-fixed, punctuation-cleaned version (preserve language)",
  "asks": ["each explicit ask, one per entry"],
  "lead_tier": "hot" | "warm" | "cold" | "unknown",
  "agent_mode": "sales" | "support" | "auto"
}

Rules:
- lead_tier hot = specific need + asks about price/features/how to start. warm = pain point, still exploring. cold = vague or just hello.
- intent_type loan = anything about borrowing money, loans, credit, zamcash, lending.
- intent_type out_of_scope = selling services TO us, job applications, unrelated requests.
- sentiment urgent = time-sensitive, angry, or repeated frustration.`;

function extractJson(s: string): any {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : s;
  try { return JSON.parse(body); } catch { /* continue */ }
  const m = body.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* continue */ } }
  return {};
}

function toTier(v: unknown): LeadTier {
  const s = String(v || 'unknown').toLowerCase();
  return (['hot', 'warm', 'cold', 'unknown'].includes(s) ? s as LeadTier : 'unknown');
}

export async function runRouter(input: SwarmInput): Promise<{ intent: IntentObject; ms: number; model: string }> {
  const start = Date.now();
  const model = Deno.env.get('SWARM_ROUTER_MODEL') || PRIMARY_TEXT_MODEL;
  const userMsg = `Channel: ${input.channel}
Customer: ${input.customer_name || 'unknown'}
Raw message:
"""${input.raw_text}"""`;

  const resp = await geminiChatWithFallback({
    model,
    temperature: 0,
    max_tokens: 512,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userMsg },
    ],
  });

  if (!resp.ok) throw new Error(`[Router] HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const raw = data.choices?.[0]?.message?.content?.trim() || '';
  const json = extractJson(raw);

  const intent: IntentObject = {
    intent_type: String(json.intent_type || 'unknown'),
    language: String(json.language || 'en'),
    sentiment: (['positive', 'neutral', 'negative', 'urgent'].includes(json.sentiment) ? json.sentiment : 'neutral') as IntentObject['sentiment'],
    entities: json.entities && typeof json.entities === 'object' ? json.entities : {},
    cleaned_text: String(json.cleaned_text || input.raw_text),
    asks: Array.isArray(json.asks) ? json.asks.map(String) : [],
    lead_tier: toTier(json.lead_tier),
    agent_mode: json.agent_mode === 'support' ? 'support' : json.agent_mode === 'sales' ? 'sales' : 'auto',
  };
  return { intent, ms: Date.now() - start, model };
}
