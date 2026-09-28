// omanut-harness client — external LLM decision layer for whatsapp-messages.
//
// The harness is a drop-in replacement for the LLM call inside the existing
// multi-round tool loop. It returns an OpenAI-shaped response
// (choices[0].message with content + tool_calls) so the caller's executors,
// loop, sends, and persistence are UNCHANGED — only who decides changes.
//
// Kill switch (per company, in companies.metadata):
//   harness_mode: 'off' (default) | 'pilot' | 'on'
//   harness_pilot_phones: string[] (E.164 or whatsapp: prefixed) — only these
//     hit the harness in pilot mode.
//
// On ANY harness non-200 / timeout / network error, callers MUST fall through
// to the in-house pipeline (never double-reply, never fail-open).

const OMANUT_HARNESS_URL = Deno.env.get('OMANUT_HARNESS_URL') || 'https://omanut-harness.omanut.online';
const OMANUT_HARNESS_API_KEY = Deno.env.get('OMANUT_HARNESS_API_KEY') || '';
const OMANUT_HARNESS_TIMEOUT_MS = Number(Deno.env.get('OMANUT_HARNESS_TIMEOUT_MS') || 12000);

export type HarnessMode = 'off' | 'pilot' | 'on';

export interface HarnessCompanyMeta {
  harness_mode?: HarnessMode | string;
  harness_pilot_phones?: string[] | null;
}

/** Normalize a phone for pilot-list comparison (strip whatsapp: and +). */
function normPhone(p: string): string {
  return String(p || '').replace(/^whatsapp:/, '').replace(/D/g, '');
}

/**
 * Decide whether this (company, phone) should route through the harness.
 * Default off — zero behavior change until a company opts in.
 */
export function isHarnessEnabled(
  metadata: HarnessCompanyMeta | null | undefined,
  phone: string | null | undefined
): boolean {
  const mode = String(metadata?.harness_mode || 'off').toLowerCase();
  if (mode === 'off' || !mode) return false;
  if (mode === 'on') return true;
  if (mode === 'pilot') {
    const pilots = Array.isArray(metadata?.harness_pilot_phones) ? metadata.harness_pilot_phones : [];
    if (!pilots.length) return false;
    const np = normPhone(phone || '');
    if (!np) return false;
    return pilots.some((p) => normPhone(p) === np);
  }
  return false;
}

export interface HarnessCall {
  session_id: string;
  messages: Array<Record<string, unknown>>;
  tools: unknown[];
  max_tokens?: number;
  temperature?: number;
}

export interface HarnessResult {
  ok: boolean;
  /** OpenAI-shaped choices[0].message */
  message?: { content?: string | null; tool_calls?: unknown[] };
  reason?: string;
  http_status?: number;
}

/**
 * Call the omanut-harness. Returns {ok:false} on any non-200, timeout, or
 * network error — the caller must then fall through to the in-house pipeline.
 * NEVER throws.
 */
// CANNED-REPLY DETECTOR
// The farm harness sometimes masks an upstream LLM failure with a generic
// acknowledgment ("Thanks for your message! We'll get back to you shortly.").
// Left undetected, that placeholder reaches the customer while the real
// fallback chain (DeepSeek/Kimi) never runs. Any canned acknowledgment is
// treated as a FAILURE so the caller falls through to a working brain.
const CANNED_REPLY_PATTERNS: RegExp[] = [
  /thanks for your message[!.]?\s*(we'?ll|we will)?\s*(get back|respond|reply)/i,
  /we'?ll get back to you shortly/i,
  /let me get our owner involved/i,
  /we will respond shortly/i,
  /your message (has been|was) received/i,
  /thank you for your message\.?\s*how can i help you today\??/i,
  /our (team|owner) will (be in touch|respond|get back)/i,
];

function isCannedReply(content: string): boolean {
  const text = String(content || '').trim();
  if (!text) return true;
  // Short + matches a canned pattern = placeholder, not an answer.
  if (text.length > 240) return false;
  return CANNED_REPLY_PATTERNS.some((re) => re.test(text));
}

// CIRCUIT BREAKER
// When the harness fails repeatedly it must stop dominating every turn: each
// attempt costs up to 12s before the real brain runs. After 3 consecutive
// failures the circuit opens and calls go straight to the direct chain
// (DeepSeek/Kimi) for 5 minutes, then the harness is probed again.
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 5 * 60 * 1000;
let harnessFailureStreak = 0;
let harnessSkipUntil = 0;

export function harnessCircuitState(): { open: boolean; streak: number; skipUntil: number } {
  return { open: Date.now() < harnessSkipUntil, streak: harnessFailureStreak, skipUntil: harnessSkipUntil };
}

export async function callHarness(call: HarnessCall): Promise<HarnessResult> {
  if (Date.now() < harnessSkipUntil) {
    console.warn('[HARNESS] circuit OPEN — skipping harness, going straight to the direct chain');
    return { ok: false, reason: 'circuit_open' };
  }
  if (!OMANUT_HARNESS_API_KEY) {
    console.warn('[HARNESS] OMANUT_HARNESS_API_KEY not configured — falling back to in-house');
    return { ok: false, reason: 'not_configured' };
  }

  const attempt = async (): Promise<HarnessResult> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), OMANUT_HARNESS_TIMEOUT_MS);
    try {
      const res = await fetch(OMANUT_HARNESS_URL + '/whatsapp/turn', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + OMANUT_HARNESS_API_KEY,
        },
        body: JSON.stringify({
          session_id: call.session_id,
          messages: call.messages,
          tools: call.tools,
          max_tokens: call.max_tokens,
          temperature: call.temperature,
        }),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let body: any = {};
      try { body = text ? JSON.parse(text) : {}; } catch { /* keep {} */ }
      if (res.ok && body.ok !== false && Array.isArray(body.choices) && body.choices[0]?.message) {
        const content = String(body.choices[0].message.content || '');
        if (isCannedReply(content)) {
          console.warn('[HARNESS] canned/placeholder reply detected — treating as failure so the real chain runs');
          harnessFailureStreak++;
          if (harnessFailureStreak >= BREAKER_THRESHOLD) {
            harnessSkipUntil = Date.now() + BREAKER_COOLDOWN_MS;
            console.warn('[HARNESS] circuit OPENED for 5 min (canned replies) — direct chain takes over');
          }
          return { ok: false, reason: 'canned_reply', http_status: res.status };
        }
        harnessFailureStreak = 0;
        harnessSkipUntil = 0;
        return {
          ok: true,
          message: body.choices[0].message,
          http_status: res.status,
        };
      }
      console.warn('[HARNESS] non-ok response', res.status, body.reason || body.error || '');
      return { ok: false, reason: body.reason || body.error || 'http_' + res.status, http_status: res.status };
    } catch (e) {
      console.warn('[HARNESS] call failed, falling back to in-house:', e instanceof Error ? e.message : e);
      return { ok: false, reason: 'network_error' };
    } finally {
      clearTimeout(timer);
    }
  };

  const first = await attempt();

  // Burst resilience: transient failures (timeouts, 5xx, 429) get ONE quick
  // retry after a short backoff — concurrent ad bursts clear in seconds, and
  // GLM-5.3-Flash has 50 concurrent slots so the retry usually lands.
  const transient = first.reason === 'network_error'
    || [429, 500, 502, 503, 504].includes(Number(first.http_status));
  if (!first.ok && transient) {
    console.warn('[HARNESS] transient failure (' + first.reason + ') — retrying once in 1.5s');
    await new Promise((r) => setTimeout(r, 1500));
    const second = await attempt();
    if (second.ok) {
      harnessFailureStreak = 0;
      harnessSkipUntil = 0;
      return second;
    }
    harnessFailureStreak++;
    if (harnessFailureStreak >= BREAKER_THRESHOLD) {
      harnessSkipUntil = Date.now() + BREAKER_COOLDOWN_MS;
      console.warn('[HARNESS] circuit OPENED for 5 min after ' + harnessFailureStreak + ' failures — direct chain takes over');
    }
    return { ok: false, reason: first.reason + ' | retry: ' + (second.reason || ''), http_status: second.http_status };
  }

  if (!first.ok) {
    harnessFailureStreak++;
    if (harnessFailureStreak >= BREAKER_THRESHOLD) {
      harnessSkipUntil = Date.now() + BREAKER_COOLDOWN_MS;
      console.warn('[HARNESS] circuit OPENED for 5 min after ' + harnessFailureStreak + ' failures — direct chain takes over');
    }
  }

  return first;
}
export { OMANUT_HARNESS_URL };


/**
 * Generic drop-in wrapper: try the harness, fall back to null.
 * Returns { ok, message? } — message is OpenAI-shaped (content + tool_calls).
 * For stateless channels (content gen, drafts) pass mode: 'content' which
 * treats the company as enabled when harness_mode === 'on' (no phone check).
 */
export interface HarnessFallbackOpts {
  companyId: string;
  phone?: string | null;
  metadata?: HarnessCompanyMeta | null;
  /** 'chat' (default, uses phone pilot check) or 'content' (company-level on only) */
  mode?: 'chat' | 'content';
}

export async function harnessChatWithFallback(
  messages: Array<Record<string, unknown>>,
  tools: unknown[],
  opts: HarnessFallbackOpts
): Promise<{ ok: boolean; message?: { content?: string | null; tool_calls?: unknown[] }; reason?: string }> {
  const mode = opts.mode || 'chat';
  const enabled = mode === 'content'
    ? String(opts.metadata?.harness_mode || 'off').toLowerCase() === 'on'
    : isHarnessEnabled(opts.metadata, opts.phone);
  if (!enabled) return { ok: false, reason: 'harness_disabled' };

  const result = await callHarness({
    session_id: `${opts.companyId}:${opts.phone || mode}`,
    messages,
    tools: tools || [],
  });
  if (result.ok && result.message) return { ok: true, message: result.message };
  return { ok: false, reason: result.reason || 'harness_error' };
}
