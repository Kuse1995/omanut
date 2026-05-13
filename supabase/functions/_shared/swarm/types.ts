// Shared types for the Omanut Social Swarm orchestrator.

export type SwarmChannel = 'whatsapp' | 'social_post' | 'meta_dm' | 'meta_comment';
export type SwarmProfile = 'full' | 'lite' | 'safety_only';
export type SwarmMode = 'sync' | 'post_hoc_refine';

export interface SwarmInput {
  company_id: string;
  channel: SwarmChannel;
  raw_text: string;
  conversation_id?: string;
  customer_name?: string;
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  /** Optional override; defaults are picked per channel. */
  profile?: SwarmProfile;
  /** sync (default) returns final_text. post_hoc_refine compares against already_sent_text. */
  mode?: SwarmMode;
  already_sent_text?: string;
  /** Free-form extra context (BMS snapshots, KB highlights, brand notes, etc.) */
  extra_context?: Record<string, unknown>;
}

export interface IntentObject {
  intent_type: string;
  language: string;
  sentiment: 'positive' | 'neutral' | 'negative' | 'urgent';
  entities: Record<string, string | number | boolean>;
  cleaned_text: string;
  asks: string[];
}

export interface RuleSet {
  must_do: string[];
  must_not: string[];
  brand_voice: string;
  facts: string[];
  language: string;
  bms_cache_hit?: boolean;
  bms_miss?: boolean;
}

export interface CritiqueReport {
  score: number;
  violations: string[];
  remedy: string;
  passed: boolean;
}

export interface SwarmRunResult {
  ok: boolean;
  final_text: string | null;
  final_score: number | null;
  retries: number;
  escalated: boolean;
  bypass_reason?: string | null;
  profile?: SwarmProfile;
  bms_cache_hit?: boolean;
  stage_timings: Record<string, number>;
  critique_history: CritiqueReport[];
  models_used: Record<string, string>;
  error?: string;
}

export const PASS_THRESHOLD = 8;
export const MAX_RETRIES = 3;

/** Per-channel hard ceilings for total swarm wall-clock time. */
export const SWARM_BUDGET_MS: Record<SwarmChannel, number> = {
  whatsapp: 12000,
  meta_dm: 12000,
  meta_comment: 20000,
  social_post: 25000,
};

/** Default profile per channel. Caller can override via SwarmInput.profile. */
export const DEFAULT_PROFILE: Record<SwarmChannel, SwarmProfile> = {
  whatsapp: 'lite',
  meta_dm: 'lite',
  meta_comment: 'full',
  social_post: 'full',
};
