// Shared types for the Omanut Social Swarm orchestrator.

export type SwarmChannel = 'whatsapp' | 'social_post' | 'meta_dm' | 'meta_comment';

export interface SwarmInput {
  company_id: string;
  channel: SwarmChannel;
  raw_text: string;
  conversation_id?: string;
  customer_name?: string;
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  /** Free-form extra context (BMS snapshots, KB highlights, brand notes, etc.) */
  extra_context?: Record<string, unknown>;
}

export interface IntentObject {
  intent_type: string;          // e.g. price_check, complaint, greeting, post_request
  language: string;             // e.g. "en", "en-ZM"
  sentiment: 'positive' | 'neutral' | 'negative' | 'urgent';
  entities: Record<string, string | number | boolean>;
  cleaned_text: string;
  asks: string[];               // explicit user requests, one per item
}

export interface RuleSet {
  must_do: string[];
  must_not: string[];
  brand_voice: string;
  facts: string[];              // scoped KB / BMS facts relevant to this intent
  language: string;
}

export interface CritiqueReport {
  score: number;                // 1-10
  violations: string[];
  remedy: string;
  passed: boolean;              // score >= 8
}

export interface SwarmRunResult {
  ok: boolean;
  final_text: string | null;
  final_score: number | null;
  retries: number;
  escalated: boolean;
  stage_timings: Record<string, number>;
  critique_history: CritiqueReport[];
  models_used: Record<string, string>;
  error?: string;
}

export const PASS_THRESHOLD = 8;
export const MAX_RETRIES = 3;
