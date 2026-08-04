// Overseer v2: pure code state machine orchestrating
// Router -> Librarian -> Strategist -> (Writer -> Critic loop) -> Closer -> Safety Gate.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { CritiqueReport, Decision, SwarmInput, SwarmRunResult, SwarmProfile } from './types.ts';
import { MAX_RETRIES, PASS_THRESHOLD, SWARM_BUDGET_MS, DEFAULT_PROFILE, HIGH_RISK_INTENTS } from './types.ts';
import { runRouter } from './router.ts';
import { runLibrarian } from './librarian.ts';
import { runStrategist } from './strategist.ts';
import { runWriter } from './writer.ts';
import { runCritic, runCriticSafetyOnly, criticDeterministicViolations } from './critic.ts';
import { runCloser } from './closer.ts';
import { runSafetyGate } from './safety-gate.ts';

/** Keep at least this much budget for the final deterministic safety pass. */
const MIN_BUDGET_REMAIN = 2500;
/** The model-based Closer polish only runs when at least this much budget is left. */
const CLOSER_BUDGET_NEED = 2000;

export async function runSwarm(
  supabase: ReturnType<typeof createClient>,
  input: SwarmInput,
): Promise<SwarmRunResult> {
  const t0 = Date.now();
  const budget = SWARM_BUDGET_MS[input.channel] ?? 15000;
  const requestedProfile: SwarmProfile = input.profile ?? DEFAULT_PROFILE[input.channel] ?? 'full';

  const stage_timings: Record<string, number> = {};
  const critique_history: CritiqueReport[] = [];
  const models_used: Record<string, string> = {};
  let final_text: string | null = null;
  let final_score: number | null = null;
  let retries = 0;
  let escalated = false;
  let bypass_reason: string | null = null;
  let decision: Decision | null = null;
  let bms_cache_hit: boolean | undefined;
  let error: string | undefined;
  let effectiveProfile: SwarmProfile = requestedProfile;

  const remaining = () => budget - (Date.now() - t0);

  try {
    // 1. Router: classify the message (intent, language, sentiment, lead tier, mode).
    const r = await runRouter(input);
    stage_timings.router_ms = r.ms;
    models_used.router = r.model;
    const intent = r.intent;

    // Upgrade lite -> full when the message is high-risk.
    if (effectiveProfile === 'lite') {
      const risky = intent.sentiment === 'negative' || intent.sentiment === 'urgent'
        || HIGH_RISK_INTENTS.has((intent.intent_type || '').toLowerCase());
      if (risky) effectiveProfile = 'full';
    }

    // 2. Librarian: company KB, rules, facts, escalation triggers, payment methods.
    const l = await runLibrarian(supabase, input, intent);
    stage_timings.librarian_ms = l.ms;
    models_used.librarian = l.model;
    const rules = l.rules;
    bms_cache_hit = rules.bms_cache_hit;

    // 3. Strategist: pick the action (answer | qualify | close | redirect | escalate | decline).
    const s = await runStrategist({ input, intent, rules });
    stage_timings.strategist_ms = s.ms;
    models_used.strategist = s.model;
    decision = s.decision;
    if (decision.needs_boss) escalated = true;

    // 4. Writer -> Critic loop. Lite profile only runs deterministic checks (no critic model call).
    const maxAttempts = effectiveProfile === 'full' ? MAX_RETRIES : 1;
    let remedy: string | null = null;
    let bestDraft: string | null = null;
    let bestScore = -1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (bestDraft && remaining() < MIN_BUDGET_REMAIN) { bypass_reason = 'budget_exhausted'; break; }
      if (!bestDraft && remaining() < 1500) { bypass_reason = 'budget_exhausted'; break; }

      const w = await runWriter({ channel: input.channel, intent, rules, decision, history: input.history, remedy, attempt });
      stage_timings[`writer_attempt_${attempt}_ms`] = w.ms;
      if (attempt === 1) models_used.writer = w.model;

      let q: { report: CritiqueReport; ms: number; model: string };
      if (effectiveProfile === 'lite') {
        const det = criticDeterministicViolations({ draft: w.draft, history: input.history });
        q = det.length === 0
          ? { report: { score: 9, violations: [], remedy: '', passed: true }, ms: 0, model: 'deterministic' }
          : { report: { score: 3, violations: det, remedy: 'REJECTED. ' + det.join(' '), passed: false }, ms: 0, model: 'deterministic' };
      } else {
        q = await runCritic({ intent, rules, decision, draft: w.draft, history: input.history });
      }
      stage_timings[`critic_attempt_${attempt}_ms`] = q.ms;
      if (attempt === 1) models_used.critic = q.model;
      critique_history.push(q.report);

      if (q.report.score > bestScore) { bestScore = q.report.score; bestDraft = w.draft; }
      if (q.report.passed) { final_text = w.draft; final_score = q.report.score; retries = attempt - 1; break; }
      retries = attempt;
      remedy = q.report.remedy || `Score was ${q.report.score}. Fix every violation and keep the reply short.`;
    }

    // Loop ended without a pass: fall back to the best draft only if it is safe.
    if (!final_text && bestDraft) {
      const sg = await runCriticSafetyOnly({ intent, rules, draft: bestDraft });
      stage_timings.safety_only_ms = sg.ms;
      if (sg.safe) {
        final_text = bestDraft;
        final_score = bestScore;
        escalated = true;
        if (!bypass_reason) bypass_reason = 'critic_loop_no_pass';
      } else {
        bypass_reason = 'safety_fail';
        final_text = null;
        final_score = bestScore;
        escalated = true;
      }
    }

    // 5. Closer: one final polish pass when the budget allows (full profile only).
    if (final_text && effectiveProfile === 'full' && decision && remaining() >= CLOSER_BUDGET_NEED) {
      try {
        const c = await runCloser({ channel: input.channel, intent, rules, decision, draft: final_text });
        stage_timings.closer_ms = c.ms;
        models_used.closer = c.model;
        final_text = c.text;
      } catch (closerErr) {
        console.warn('[Swarm] closer failed, keeping draft:', closerErr);
      }
    }

    // 6. Safety Gate: fail-closed checkpoint. On ANY unsafe signal, do not send.
    if (final_text) {
      const gate = await runSafetyGate({
        intent,
        rules,
        draft: final_text,
        history: input.history,
        modelCheck: effectiveProfile === 'full' && remaining() >= 1500,
      });
      stage_timings.safety_gate_ms = gate.ms;
      models_used.safety_gate = gate.model;
      if (!gate.safe) {
        bypass_reason = 'safety_fail';
        final_text = null;
        final_score = null;
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
    decision,
    bms_cache_hit,
    stage_timings,
    critique_history,
    models_used,
    error,
  };
}

export { PASS_THRESHOLD, MAX_RETRIES };
