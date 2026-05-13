// Creative: drafts the actual reply using MiniMax-M2 (creative, t=0.7).
// Falls back to glm-4.7 t=0.7 via geminiChatWithFallback chain if MiniMax fails.
import { geminiChatWithFallback } from '../gemini-client.ts';
import type { IntentObject, RuleSet, SwarmChannel } from './types.ts';

const SYSTEM_BASE = `You are the CREATIVE writer for an AI agent swarm.
You draft a single response based on the IntentObject + RuleSet you receive.
You do NOT call tools, you do NOT add JSON, you do NOT ask clarifying questions.
You output only the final user-facing text.

Hard constraints:
- Obey every "MUST DO" and "MUST NOT" rule.
- Only use the FACTS provided. If a fact is missing, do not invent it — say we'll check and follow up.
- Match the user's language.
- Keep brand voice consistent.
- If a previous critique remedy is provided, you MUST address every point in it.`;

export async function runCreative(args: {
  channel: SwarmChannel;
  intent: IntentObject;
  rules: RuleSet;
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  remedy?: string | null;
  attempt: number;
}): Promise<{ draft: string; ms: number; model: string }> {
  const start = Date.now();
  const model = 'MiniMax-M2';

  const channelHint = args.channel === 'social_post'
    ? 'Output a social media caption (100-300 chars), include 1-3 emojis and a clear CTA.'
    : args.channel === 'meta_comment'
      ? 'Output a short public comment reply (under 200 chars), warm and on-brand.'
      : 'Output a WhatsApp reply (1-3 short sentences).';

  const remedyBlock = args.remedy
    ? `\n\n=== PRIOR CRITIQUE — YOU MUST FIX ALL POINTS ===\n${args.remedy}\n=== END CRITIQUE ===`
    : '';

  const userMsg = `CHANNEL: ${args.channel}
${channelHint}

INTENT:
${JSON.stringify(args.intent, null, 2)}

RULES:
MUST DO:
${args.rules.must_do.map(r => `- ${r}`).join('\n') || '- (none)'}

MUST NOT:
${args.rules.must_not.map(r => `- ${r}`).join('\n') || '- (none)'}

BRAND VOICE: ${args.rules.brand_voice}
LANGUAGE: ${args.rules.language}

FACTS (only source of truth):
${args.rules.facts.map(f => `- ${f}`).join('\n') || '- (no specific facts available)'}${remedyBlock}

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
  if (!draft) throw new Error('[Creative] empty draft');
  return { draft, ms: Date.now() - start, model };
}
