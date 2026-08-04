// Writer v2: drafts the actual reply for the chosen strategy. t=0.7, resilient fallback chain.
import { geminiChatWithFallback, PRIMARY_TEXT_MODEL } from '../gemini-client.ts';
import type { Decision, IntentObject, RuleSet, SwarmChannel } from './types.ts';

const SYSTEM_BASE = `You are the WRITER of an AI agent swarm for an African SME business assistant.
You write ONE customer-facing response based on the STRATEGY + RULES + FACTS you receive.
You do NOT call tools, you do NOT add JSON, you do NOT mention the swarm or any internal analysis.
You output only the final user-facing text.

Hard constraints:
- Obey every "MUST DO" and "MUST NOT" rule.
- Only use the FACTS provided. If a fact is missing, do not invent it - say we will check and follow up.
- Match the customer's language.
- Keep brand voice consistent.
- If a previous critique remedy is provided, you MUST address every point in it.
- Never output internal tags, tool calls, or control strings.`;

export async function runWriter(args: {
  channel: SwarmChannel;
  intent: IntentObject;
  rules: RuleSet;
  decision: Decision;
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  remedy?: string | null;
  attempt: number;
}): Promise<{ draft: string; ms: number; model: string }> {
  const start = Date.now();
  const model = Deno.env.get('SWARM_WRITER_MODEL') || PRIMARY_TEXT_MODEL;

  const channelHint = args.channel === 'social_post'
    ? 'Output a social media caption (100-300 chars), 1-3 emojis and a clear CTA.'
    : args.channel === 'meta_comment'
      ? 'Output a short public comment reply (under 200 chars), warm and on-brand.'
      : 'Output a WhatsApp reply (1-3 short sentences, mobile-friendly).';

  const strategyHint: Record<string, string> = {
    answer: 'Answer the question directly and completely using FACTS.',
    qualify: 'Ask ONE focused question to surface their need. Do not recommend a plan yet.',
    close: 'Confirm their choice, summarize what they get, and move to payment using only the payment facts available.',
    redirect: 'Politely clarify this business does not lend money / does not provide that service. State clearly what the business actually does. Do not pitch.',
    escalate: 'Apologize sincerely for the frustration or delay, answer as much as you can from FACTS, and say the team is stepping in to help directly.',
    decline: 'Politely decline the request. If relevant, redirect to what the business actually offers.',
  };

  const remedyBlock = args.remedy
    ? '\n\n=== PRIOR CRITIQUE - YOU MUST FIX ALL POINTS ===\n' + args.remedy + '\n=== END CRITIQUE ==='
    : '';

  const userMsg = `CHANNEL: ${args.channel}
${channelHint}

STRATEGY: ${args.decision.action}
STRATEGY REASON: ${args.decision.reason}
STRATEGY NEXT STEP: ${args.decision.next_step}

INTENT:
${JSON.stringify(args.intent, null, 2)}

RULES:
MUST DO:
${args.rules.must_do.map((r) => '- ' + r).join('\n') || '- (none)'}

MUST NOT:
${args.rules.must_not.map((r) => '- ' + r).join('\n') || '- (none)'}

BRAND VOICE: ${args.rules.brand_voice}
LANGUAGE: ${args.rules.language}

FACTS (only source of truth):
${args.rules.facts.map((f) => '- ' + f).join('\n') || '- (no specific facts available)'}${remedyBlock}

Now write the response. Output ONLY the response text.`;

  const messages: any[] = [
    { role: 'system', content: SYSTEM_BASE },
    ...((args.history || []).slice(-6)),
    { role: 'user', content: userMsg },
  ];

  const resp = await geminiChatWithFallback({
    model,
    temperature: 0.7,
    max_tokens: args.channel === 'social_post' ? 400 : 350,
    messages,
  });

  const data = await resp.json();
  const draft = (data.choices?.[0]?.message?.content || '').trim();
  if (!draft) throw new Error('[Writer] empty draft');
  return { draft, ms: Date.now() - start, model };
}
