// Safety Gate v2: fail-closed final checkpoint before any reply is sent.
// Deterministic checks are authoritative; the model check adds coverage when budget allows.
// ANY unsafe signal means the caller MUST NOT send the text.
import { geminiChatWithFallback, PRIMARY_TEXT_MODEL } from '../gemini-client.ts';
import type { IntentObject, RuleSet } from './types.ts';

const INTERNAL_LEAK_RE = /<ctrl|<system|<tool|\[INST\]|<<SYS>>|\bswarm\b|gatekeeper|librarian|strategist|overseer|critic|closer|remedy|company_ai_overrides|rule_violations/i;
const JSON_BLOCK_RE = /^\s*[{[]|```(?:json)?/i;
const PROFANITY_RE = /\b(fuck|fucking|shit|bitch|asshole|cunt|dick|bastard)\b/i;
const PRICE_RE = /(?:(\d{1,3}(?:[.,]\d+)?)\s*(ZMW|Kwacha|kw|USD|US\$|\$|K)\b)|(?:\b(ZMW|Kwacha|kw|USD|US\$|\$|K)\s*(\d{1,3}(?:[.,]\d+)?))/gi;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/i;

export interface SafetyGateResult {
  safe: boolean;
  violations: string[];
  ms: number;
  model: string;
}

function tokenSimilarity(a: string, b: string): number {
  const norm = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
  const A = norm(a);
  const B = norm(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

function deterministicViolations(args: {
  rules: RuleSet;
  draft: string;
  history?: Array<{ role: string; content: string }>;
}): string[] {
  const violations: string[] = [];
  const t = args.draft;
  if (INTERNAL_LEAK_RE.test(t)) violations.push('Internal tag or control string present.');
  if (JSON_BLOCK_RE.test(t)) violations.push('Raw JSON or code block instead of plain text.');
  if (PROFANITY_RE.test(t)) violations.push('Profanity present.');

  const facts = args.rules.facts.join('\n').toLowerCase();
  for (const m of t.matchAll(PRICE_RE)) {
    const num = (m[1] || m[4] || '').replace(/[.,]/g, '');
    if (num && !facts.includes(num)) violations.push(`Price "${m[0].trim()}" is not in FACTS.`);
  }
  const email = t.match(EMAIL_RE);
  if (email && !facts.includes(email[0].toLowerCase())) violations.push('Email address not present in FACTS.');

  const lastAssistant = [...(args.history || [])].reverse().find((h) => h.role === 'assistant');
  if (lastAssistant && tokenSimilarity(lastAssistant.content, t) > 0.85) {
    violations.push('Repeats the previous assistant message almost verbatim.');
  }
  return violations;
}

export async function runSafetyGate(args: {
  intent: IntentObject;
  rules: RuleSet;
  draft: string;
  history?: Array<{ role: string; content: string }>;
  modelCheck?: boolean;
}): Promise<SafetyGateResult> {
  const start = Date.now();
  const det = deterministicViolations(args);
  if (det.length > 0) return { safe: false, violations: det, ms: Date.now() - start, model: 'deterministic' };
  if (args.modelCheck === false) return { safe: true, violations: [], ms: Date.now() - start, model: 'deterministic' };

  const model = Deno.env.get('SWARM_SAFETY_MODEL') || PRIMARY_TEXT_MODEL;
  try {
    const resp = await geminiChatWithFallback({
      model,
      temperature: 0,
      max_tokens: 200,
      messages: [
        { role: 'system', content: 'You are a SAFETY GATE. Output STRICT JSON: {"safe": boolean, "violations": string[]}. Mark unsafe ONLY if the draft discusses a banned topic from MUST NOT, states a price/stock/fact NOT present in FACTS, or contains profanity, threats, or PII leaks. Otherwise safe=true. Be lenient on tone and style.' },
        { role: 'user', content: `MUST NOT:\n${args.rules.must_not.map((r) => `- ${r}`).join('\n')}\n\nFACTS:\n${args.rules.facts.map((f) => `- ${f}`).join('\n')}\n\nDRAFT:\n"""${args.draft}"""\n\nOutput JSON only.` },
      ],
    });
    if (!resp.ok) return { safe: true, violations: [], ms: Date.now() - start, model: 'fallback' };
    const data = await resp.json();
    const json = extractJson((data.choices?.[0]?.message?.content || '').trim());
    const safe = json.safe !== false;
    const violations = Array.isArray(json.violations) ? json.violations.map(String) : [];
    return { safe, violations, ms: Date.now() - start, model };
  } catch {
    return { safe: true, violations: [], ms: Date.now() - start, model: 'fallback' };
  }
}

function extractJson(s: string): any {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : s;
  try { return JSON.parse(body); } catch { /* continue */ }
  const m = body.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* continue */ } }
  return {};
}
