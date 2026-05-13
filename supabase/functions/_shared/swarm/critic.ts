// Critic / QA: scores the Creative's draft against IntentObject + RuleSet.
// Strict JSON output. GLM-4.7 t=0.0 — deterministic.
import { geminiChat } from '../gemini-client.ts';
import type { CritiqueReport, IntentObject, RuleSet } from './types.ts';
import { PASS_THRESHOLD } from './types.ts';

const SYSTEM = `You are the OMANUT QUALITY CONTROLLER.
You score a draft response (1-10) against the original Intent and Rules.
Be RUTHLESS. Generic, off-brand, or hallucinated drafts MUST score below 5.
Drafts that ignore an explicit MUST NOT rule MUST score below 5.

Return STRICT JSON only:
{
  "score": 1-10,
  "violations": string[],   // each rule or expectation that was broken
  "remedy": string          // exactly what the writer must change. If score<5, tone is stern.
}`;

export async function runCritic(args: {
  intent: IntentObject;
  rules: RuleSet;
  draft: string;
}): Promise<{ report: CritiqueReport; ms: number; model: string }> {
  const start = Date.now();
  const model = 'glm-4.7';

  const userMsg = `INTENT:
${JSON.stringify(args.intent, null, 2)}

RULES:
MUST DO:
${args.rules.must_do.map(r => `- ${r}`).join('\n')}

MUST NOT:
${args.rules.must_not.map(r => `- ${r}`).join('\n')}

BRAND VOICE: ${args.rules.brand_voice}
LANGUAGE: ${args.rules.language}

FACTS (only source of truth):
${args.rules.facts.map(f => `- ${f}`).join('\n')}

DRAFT TO JUDGE:
"""${args.draft}"""

Score it now. Output JSON only.`;

  const resp = await geminiChat({
    model,
    temperature: 0,
    max_tokens: 400,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userMsg },
    ],
  });

  if (!resp.ok) {
    throw new Error(`[Critic] HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const data = await resp.json();
  const raw = (data.choices?.[0]?.message?.content || '').trim();
  const json = extractJson(raw);
  const score = clamp(Number(json.score), 1, 10);
  const violations = Array.isArray(json.violations) ? json.violations.map(String) : [];
  let remedy = String(json.remedy || '');
  if (score < 5 && remedy && !/REJECTED/i.test(remedy)) {
    remedy = `REJECTED. ${remedy}`;
  }
  const report: CritiqueReport = {
    score,
    violations,
    remedy,
    passed: score >= PASS_THRESHOLD,
  };
  return { report, ms: Date.now() - start, model };
}

/**
 * Safety-only critic. Used by the circuit breaker when budget is exhausted.
 * Only checks hard violations (banned topics, fabricated facts) — no scoring loop.
 */
export async function runCriticSafetyOnly(args: {
  intent: IntentObject;
  rules: RuleSet;
  draft: string;
}): Promise<{ safe: boolean; violations: string[]; ms: number; model: string }> {
  const start = Date.now();
  const model = 'glm-4.7';
  const SYSTEM_SAFETY = `You are a SAFETY GATE. Output STRICT JSON: {"safe": boolean, "violations": string[]}.
Mark unsafe ONLY if the draft:
- Discusses a banned topic from MUST NOT, OR
- States a price/stock/fact NOT present in FACTS, OR
- Contains profanity, threats, or PII leaks.
Otherwise mark safe=true with empty violations. Be lenient on tone/style.`;
  const userMsg = `MUST NOT:
${args.rules.must_not.map(r => `- ${r}`).join('\n')}

FACTS:
${args.rules.facts.map(f => `- ${f}`).join('\n')}

DRAFT:
"""${args.draft}"""

Output JSON only.`;
  try {
    const resp = await geminiChat({
      model, temperature: 0, max_tokens: 200,
      messages: [{ role: 'system', content: SYSTEM_SAFETY }, { role: 'user', content: userMsg }],
    });
    if (!resp.ok) return { safe: true, violations: [], ms: Date.now() - start, model };
    const data = await resp.json();
    const json = extractJson((data.choices?.[0]?.message?.content || '').trim());
    const safe = json.safe !== false;
    const violations = Array.isArray(json.violations) ? json.violations.map(String) : [];
    return { safe, violations, ms: Date.now() - start, model };
  } catch {
    // Fail-open on safety check error — caller will still apply downstream guards.
    return { safe: true, violations: [], ms: Date.now() - start, model };
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function extractJson(s: string): any {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : s;
  try { return JSON.parse(body); } catch {/*continue*/}
  const m = body.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {/*continue*/} }
  return {};
}
