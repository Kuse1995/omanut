// Critic v2: scores the Writer's draft against the intent, rules and strategy.
// Deterministic pre-checks (repeat detection, internal-tag leaks, raw JSON output) run first
// and can short-circuit; the model then scores 1-10 at t=0 via the shared fallback chain.
import { geminiChatWithFallback, PRIMARY_TEXT_MODEL } from '../gemini-client.ts';
import type { CritiqueReport, Decision, IntentObject, RuleSet } from './types.ts';
import { PASS_THRESHOLD } from './types.ts';

const INTERNAL_LEAK_RE = /<ctrl|<system|<tool|\[INST\]|<<SYS>>|\bswarm\b|gatekeeper|librarian|strategist|overseer|critic|remedy|company_ai_overrides|rule_violations/i;
const JSON_BLOCK_RE = /^\s*[{[]|```(?:json)?/i;

const SYSTEM = `You are the OMANUT QUALITY CONTROLLER (CRITIC).
You score a draft response (1-10) against the original Intent, Rules and Strategy.
Be RUTHLESS. Generic, off-brand, or hallucinated drafts MUST score below 5.
Drafts that ignore an explicit MUST NOT rule MUST score below 5.

Return STRICT JSON only:
{
  "score": 1-10,
  "violations": string[],
  "remedy": string
}`;

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

/** Deterministic, model-free checks that fail a draft immediately. */
export function criticDeterministicViolations(args: {
  draft: string;
  history?: Array<{ role: string; content: string }>;
}): string[] {
  const violations: string[] = [];
  const t = args.draft;
  if (INTERNAL_LEAK_RE.test(t)) violations.push('Contains an internal tag, tool call, or swarm control string.');
  if (JSON_BLOCK_RE.test(t)) violations.push('Output looks like raw JSON or a code block instead of a customer reply.');
  const lastAssistant = [...(args.history || [])].reverse().find((m) => m.role === 'assistant');
  if (lastAssistant && tokenSimilarity(lastAssistant.content, t) > 0.85) {
    violations.push('Repeats the previous assistant message almost verbatim.');
  }
  return violations;
}

export async function runCritic(args: {
  intent: IntentObject;
  rules: RuleSet;
  decision?: Decision | null;
  draft: string;
  history?: Array<{ role: string; content: string }>;
}): Promise<{ report: CritiqueReport; ms: number; model: string }> {
  const start = Date.now();
  const hard = criticDeterministicViolations({ draft: args.draft, history: args.history });
  if (hard.length > 0) {
    const report: CritiqueReport = {
      score: 3,
      violations: hard,
      remedy: 'REJECTED. ' + hard.join(' ') + ' Rewrite as a natural, human customer reply with no internal markers.',
      passed: false,
    };
    return { report, ms: Date.now() - start, model: 'deterministic' };
  }

  const model = Deno.env.get('SWARM_CRITIC_MODEL') || PRIMARY_TEXT_MODEL;
  const userMsg = `INTENT:
${JSON.stringify(args.intent, null, 2)}

STRATEGY: ${args.decision?.action || 'answer'} - ${args.decision?.reason || 'no reason given'}
NEXT STEP: ${args.decision?.next_step || ''}

RULES:
MUST DO:
${args.rules.must_do.map((r) => `- ${r}`).join('\n')}

MUST NOT:
${args.rules.must_not.map((r) => `- ${r}`).join('\n')}

BRAND VOICE: ${args.rules.brand_voice}
LANGUAGE: ${args.rules.language}

FACTS (only source of truth):
${args.rules.facts.map((f) => `- ${f}`).join('\n')}

DRAFT TO JUDGE:
"""${args.draft}"""

Score it now. Output JSON only.`;

  const resp = await geminiChatWithFallback({
    model,
    temperature: 0,
    max_tokens: 400,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userMsg },
    ],
  });
  if (!resp.ok) throw new Error(`[Critic] HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const json = extractJson((data.choices?.[0]?.message?.content || '').trim());
  const score = clamp(Number(json.score), 1, 10);
  const violations = Array.isArray(json.violations) ? json.violations.map(String) : [];
  let remedy = String(json.remedy || '');
  if (score < PASS_THRESHOLD && remedy && !/^REJECTED/i.test(remedy)) remedy = `REJECTED. ${remedy}`;
  const report: CritiqueReport = { score, violations, remedy, passed: score >= PASS_THRESHOLD };
  return { report, ms: Date.now() - start, model };
}

/** Cheap safety pre-check used when the critique loop has no budget or attempts left. */
export async function runCriticSafetyOnly(args: {
  intent: IntentObject;
  rules: RuleSet;
  draft: string;
}): Promise<{ safe: boolean; violations: string[]; ms: number; model: string }> {
  const start = Date.now();
  const hard = criticDeterministicViolations({ draft: args.draft });
  if (hard.length > 0) return { safe: false, violations: hard, ms: Date.now() - start, model: 'deterministic' };
  const model = Deno.env.get('SWARM_CRITIC_MODEL') || PRIMARY_TEXT_MODEL;
  try {
    const resp = await geminiChatWithFallback({
      model,
      temperature: 0,
      max_tokens: 200,
      messages: [
        { role: 'system', content: 'You are a SAFETY GATE. Output STRICT JSON: {"safe": boolean, "violations": string[]}. Mark unsafe ONLY if the draft discusses a banned topic from MUST NOT, states a price/stock/fact NOT present in FACTS, or contains profanity, threats, or PII leaks. Otherwise safe=true.' },
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

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function extractJson(s: string): any {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : s;
  try { return JSON.parse(body); } catch { /* continue */ }
  const m = body.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* continue */ } }
  return {};
}
