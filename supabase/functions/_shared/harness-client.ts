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
export async function callHarness(call: HarnessCall): Promise<HarnessResult> {
  if (!OMANUT_HARNESS_API_KEY) {
    console.warn('[HARNESS] OMANUT_HARNESS_API_KEY not configured — falling back to in-house');
    return { ok: false, reason: 'not_configured' };
  }
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
}

export { OMANUT_HARNESS_URL };
