// Closer v2: final polish pass after the critique loop.
// Shortens to channel-appropriate length, strips hard-sell phrasing, and keeps every factual
// claim intact. Runs only when the budget allows, in full profile.
import { geminiChatWithFallback, PRIMARY_TEXT_MODEL } from '../gemini-client.ts';
import type { Decision, IntentObject, RuleSet, SwarmChannel } from './types.ts';


export async function runCloser(args: {
  channel: SwarmChannel;
  intent: IntentObject;
  rules: RuleSet;
  decision: Decision;
  draft: string;
}): Promise<{ text: string; ms: number; model: string }> {
  const start = Date.now();
  const model = Deno.env.get('SWARM_CLOSER_MODEL') || PRIMARY_TEXT_MODEL;

  const channelHint = args.channel === 'social_post'
    ? 'A social caption: under 300 characters, natural, one clear CTA.'
    : args.channel === 'meta_comment'
      ? 'A short public comment: under 200 characters, warm, no hard sell.'
      : 'A WhatsApp reply: 1-3 short sentences, no hard sell.';

  const userMsg = `STRATEGY: ${args.decision.action}
NEXT STEP: ${args.decision.next_step}

FACTS (only source of truth):
${args.rules.facts.map((f) => `- ${f}`).join('\n')}

DRAFT TO POLISH:
"""${args.draft}"""

Polish instructions:
- Keep every factual claim intact. Never add facts that are not in FACTS.
- Remove pushy sales language (hurry, act now, limited time, buy now, last chance).
- Shorten to the channel length above while keeping the meaning and the next step.
- Keep the customer's language and the brand voice.
Output ONLY the polished text.`;

  const resp = await geminiChatWithFallback({
    model,
    temperature: 0.3,
    max_tokens: 400,
    messages: [
      { role: 'system', content: 'You are the CLOSER of an AI agent swarm. You polish one customer-facing reply. Output ONLY the final text.' },
      { role: 'user', content: userMsg },
    ],
  });
  if (!resp.ok) throw new Error(`[Closer] HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const text = (data.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new Error('[Closer] empty polish');

  // Deterministic cleanup on top of the model pass
  const clean = text
    .replace(/```(?:json)?/gi, '')
    .replace(/<ctrl[^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { text: clean, ms: Date.now() - start, model };
}
