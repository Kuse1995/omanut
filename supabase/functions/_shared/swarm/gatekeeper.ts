// Gatekeeper: normalizes raw inbound text into a clean IntentObject.
// Cheap deterministic GLM call. Returns strict JSON.
import { geminiChat } from '../gemini-client.ts';
import type { IntentObject, SwarmInput } from './types.ts';

const SYSTEM = `You are the GATEKEEPER for an AI agent swarm.
Your only job is to normalize the user's raw message into a clean Intent Object.
You DO NOT answer the user. You DO NOT add commentary.
Return STRICT JSON only — no markdown, no prose.

Schema:
{
  "intent_type": string,        // short snake_case, e.g. price_check, complaint, greeting, reservation, post_request
  "language": string,            // BCP-47, e.g. "en", "en-ZM", "fr"
  "sentiment": "positive"|"neutral"|"negative"|"urgent",
  "entities": object,            // extracted product names, quantities, dates, amounts, names
  "cleaned_text": string,        // typo-fixed, punctuation-cleaned version of input (preserve language)
  "asks": string[]               // each explicit ask, one per array entry
}`;

export async function runGatekeeper(input: SwarmInput): Promise<{ intent: IntentObject; ms: number; model: string }> {
  const start = Date.now();
  const model = 'MiniMax-M2';
  const userMsg = `Channel: ${input.channel}
Customer: ${input.customer_name || 'unknown'}
Raw message:
"""${input.raw_text}"""`;

  const resp = await geminiChat({
    model,
    temperature: 0,
    max_tokens: 512,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userMsg },
    ],
  });

  if (!resp.ok) {
    throw new Error(`[Gatekeeper] HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const data = await resp.json();
  const raw = data.choices?.[0]?.message?.content?.trim() || '';
  const json = extractJson(raw);
  const intent: IntentObject = {
    intent_type: String(json.intent_type || 'unknown'),
    language: String(json.language || 'en'),
    sentiment: (['positive', 'neutral', 'negative', 'urgent'].includes(json.sentiment) ? json.sentiment : 'neutral'),
    entities: json.entities && typeof json.entities === 'object' ? json.entities : {},
    cleaned_text: String(json.cleaned_text || input.raw_text),
    asks: Array.isArray(json.asks) ? json.asks.map(String) : [],
  };
  return { intent, ms: Date.now() - start, model };
}

function extractJson(s: string): any {
  // Strip code fences if present
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : s;
  try {
    return JSON.parse(body);
  } catch {
    // Try to find first {...} block
    const m = body.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { /* fall through */ }
    }
    return {};
  }
}
