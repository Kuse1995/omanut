// Shared channel normalization + per-channel knobs for the centralized
// auto-reply pipeline (inbound_events → openclaw-worker).

export type NormalizedChannel = 'whatsapp' | 'direct_message' | 'public_comment';
export type EventSource =
  | 'twilio'
  | 'meta_whatsapp'
  | 'meta_dm_fb'
  | 'meta_dm_ig'
  | 'meta_comment_fb'
  | 'meta_comment_ig';

export function sourceToChannel(source: EventSource): NormalizedChannel {
  switch (source) {
    case 'twilio':
    case 'meta_whatsapp':
      return 'whatsapp';
    case 'meta_dm_fb':
    case 'meta_dm_ig':
      return 'direct_message';
    case 'meta_comment_fb':
    case 'meta_comment_ig':
      return 'public_comment';
  }
}

/** History window per channel — comments are essentially one-shot exchanges. */
export function historyBudget(channel: NormalizedChannel): number {
  return channel === 'public_comment' ? 2 : 6;
}

export type ErrorClass =
  | 'webhook_404'
  | 'auth'
  | 'tunnel_dead'
  | 'timeout'
  | 'empty_ai'
  | 'send_failed'
  | 'rate_limited'
  | 'unknown';

/** Exponential-ish backoff schedule (seconds) keyed by attempt number (1-based). */
const BACKOFF_SECONDS = [2, 10, 60, 300, 1800]; // 2s, 10s, 1m, 5m, 30m
export const MAX_ATTEMPTS = BACKOFF_SECONDS.length;

export function nextAttemptAt(attempts: number): string {
  const idx = Math.min(Math.max(attempts, 1), BACKOFF_SECONDS.length) - 1;
  return new Date(Date.now() + BACKOFF_SECONDS[idx] * 1000).toISOString();
}

export function classifyError(status: number | null, errText: string): ErrorClass {
  const t = (errText || '').toLowerCase();
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'webhook_404';
  if (status === 429) return 'rate_limited';
  if (status && status >= 500) return 'tunnel_dead';
  if (t.includes('timeout') || t.includes('aborted')) return 'timeout';
  if (t.includes('empty') && t.includes('ai')) return 'empty_ai';
  return 'unknown';
}
