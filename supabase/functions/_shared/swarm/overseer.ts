// Overseer: pure code state machine. Runs the loop.
// Gatekeeper → Librarian → (Creative → Critic) up to MAX_RETRIES → return.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { CritiqueReport, SwarmInput, SwarmRunResult, SwarmProfile } from './types.ts';
import { MAX_RETRIES, PASS_THRESHOLD, SWARM_BUDGET_MS, DEFAULT_PROFILE } from './types.ts';
import { runGatekeeper } from './gatekeeper.ts';
import { runLibrarian } from './librarian.ts';
import { runCreative } from './creative.ts';
import { runCritic, runCriticSafetyOnly } from './critic.ts';

const HIGH_RISK_INTENTS = new Set(['complaint', 'refund', 'legal', 'escalation', 'chargeback', 'cancel']);

export async function runSwarm(
  supabase: ReturnType<typeof createClient>,
  input: SwarmInput,
): Promise<SwarmRunResult> {
  const t0 = Date.now();
  const budget = SWARM_BUDGET_MS[input.channel] ?? 12000;
  const requestedProfile: SwarmProfile = input.profile ?? DEFAULT_PROFILE[input.channel] ?? 'full';

  const stage_timings: Record<string, number> = {};
  const critique_history: CritiqueReport[] = [];
  const models_used: Record<string, string> = {};
  let final_text: string | null = null;
  let final_score: number | null = null;
  let escalated = false;
  let bypass_reason: string | null = null;
  let bms_cache_hit: boolean | undefined;
  let error: string | undefined;
  let retries = 0;
  let effectiveProfile: SwarmProfile = requestedProfile;

  const remaining = () => budget - (Date.now() - t0);

  try {
    // 1. Gatekeeper
    const g = await runGatekeeper(input);
    stage_timings.gatekeeper_ms = g.ms;
    models_used.gatekeeper = g.model;
    const intent = g.intent;

    // Upgrade lite → full when sentiment is hot or intent is high-risk
    if (effectiveProfile === 'lite') {
      const hot = intent.sentiment === 'negative' || intent.sentiment === 'urgent';
      const risky = HIGH_RISK_INTENTS.has((intent.intent_type || '').toLowerCase());
      if (hot || risky) effectiveProfile = 'full';
    }

    // 2. Librarian
    const l = await runLibrarian(supabase, input, intent);
    stage_timings.librarian_ms = l.ms;
    models_used.librarian = l.model;
    const rules = l.rules;
    bms_cache_hit = rules.bms_cache_hit;

    // Max attempts depends on profile
    const maxAttempts = effectiveProfile === 'full' ? MAX_RETRIES : 1;

    let remedy: string | null = null;
    let bestDraft: string | null = null;
    let bestScore = -1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Circuit breaker: if we don't have ~4s of budget left, stop and safety-bypass.
      if (remaining() < 4000 && bestDraft) {
        bypass_reason = 'budget_exhausted';
        break;
      }

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

    // Loop ended without pass → safety-only check on best draft
    if (!final_text && bestDraft) {
      const sg = await runCriticSafetyOnly({ intent, rules, draft: bestDraft });
      stage_timings.safety_only_ms = sg.ms;
      if (sg.safe) {
        final_text = bestDraft;
        final_score = bestScore;
        escalated = true;
        if (!bypass_reason) bypass_reason = 'critic_loop_no_pass';
      } else {
        // Hard fail — caller falls back.
        bypass_reason = 'safety_fail';
        final_text = null;
        final_score = bestScore;
        escalated = true;
      }
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
    bypass_reason,
    profile: effectiveProfile,
    bms_cache_hit,
    stage_timings,
    critique_history,
    models_used,
    error,
  };
}

export { PASS_THRESHOLD, MAX_RETRIES };
