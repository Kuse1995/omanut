// Overseer: pure code state machine. Runs the loop.
// Gatekeeper → Librarian → (Creative → Critic) up to MAX_RETRIES → return.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { CritiqueReport, SwarmInput, SwarmRunResult } from './types.ts';
import { MAX_RETRIES, PASS_THRESHOLD } from './types.ts';
import { runGatekeeper } from './gatekeeper.ts';
import { runLibrarian } from './librarian.ts';
import { runCreative } from './creative.ts';
import { runCritic } from './critic.ts';

export async function runSwarm(
  supabase: ReturnType<typeof createClient>,
  input: SwarmInput,
): Promise<SwarmRunResult> {
  const stage_timings: Record<string, number> = {};
  const critique_history: CritiqueReport[] = [];
  const models_used: Record<string, string> = {};
  let final_text: string | null = null;
  let final_score: number | null = null;
  let escalated = false;
  let error: string | undefined;
  let retries = 0;

  try {
    // 1. Gatekeeper
    const g = await runGatekeeper(input);
    stage_timings.gatekeeper_ms = g.ms;
    models_used.gatekeeper = g.model;
    const intent = g.intent;

    // 2. Librarian
    const l = await runLibrarian(supabase, input, intent);
    stage_timings.librarian_ms = l.ms;
    models_used.librarian = l.model;
    const rules = l.rules;

    // 3. Creative ↔ Critic loop
    let remedy: string | null = null;
    let bestDraft: string | null = null;
    let bestScore = -1;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const c = await runCreative({
        channel: input.channel,
        intent,
        rules,
        history: input.history,
        remedy,
        attempt,
      });
      stage_timings[`creative_attempt_${attempt}_ms`] = c.ms;
      if (attempt === 1) models_used.creative = c.model;

      const q = await runCritic({ intent, rules, draft: c.draft });
      stage_timings[`critic_attempt_${attempt}_ms`] = q.ms;
      if (attempt === 1) models_used.critic = q.model;
      critique_history.push(q.report);

      if (q.report.score > bestScore) {
        bestScore = q.report.score;
        bestDraft = c.draft;
      }

      if (q.report.passed) {
        final_text = c.draft;
        final_score = q.report.score;
        retries = attempt - 1;
        break;
      }

      retries = attempt;
      remedy = q.report.remedy || `Score was ${q.report.score}. Address all violations.`;
    }

    // Loop ended without pass — use best draft, mark escalated.
    if (!final_text) {
      final_text = bestDraft;
      final_score = bestScore;
      escalated = true;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    console.error('[Swarm] error:', error);
  }

  return {
    ok: !!final_text && !error,
    final_text,
    final_score,
    retries,
    escalated,
    stage_timings,
    critique_history,
    models_used,
    error,
  };
}

export { PASS_THRESHOLD, MAX_RETRIES };
