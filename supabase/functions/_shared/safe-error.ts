/**
 * Returns a generic, safe error message for client responses.
 * Logs the real error server-side for debugging.
 */
export function safeErrorMessage(error: unknown, context?: string): string {
  // Log the real error for debugging
  if (context) {
    console.error(`[${context}] Error:`, error);
  }
  return 'An error occurred processing your request';
}

/**
 * Creates a safe JSON error response with CORS headers.
 */
export function safeErrorResponse(
  error: unknown,
  corsHeaders: Record<string, string>,
  context?: string,
  status = 500
): Response {
  const message = safeErrorMessage(error, context);
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Categorize an AI/LLM error so callers can decide retry vs. fallback vs. handoff.
 * Looks at HTTP status (when attached to the error), the error name, and message text.
 */
export type AiErrorKind =
  | 'rate_limit'
  | 'no_credits'
  | 'timeout'
  | 'malformed'
  | 'tool_failure'
  | 'unknown';

export function classifyAiError(err: unknown): AiErrorKind {
  if (!err) return 'unknown';
  const e = err as any;
  const status: number | undefined =
    typeof e?.status === 'number' ? e.status :
    typeof e?.statusCode === 'number' ? e.statusCode :
    typeof e?.code === 'number' ? e.code : undefined;

  const name = String(e?.name || '').toLowerCase();
  const msg = String(e?.message || e || '').toLowerCase();

  if (status === 429 || /rate[_\s-]?limit|too many requests|quota/i.test(msg)) return 'rate_limit';
  if (status === 402 || /payment required|insufficient (credits|funds|balance)|no credits|out of credits/i.test(msg)) return 'no_credits';
  if (name === 'aborterror' || /abort(ed)?|timeout|timed out|deadline/i.test(msg)) return 'timeout';
  if (/json|parse|unexpected token|unexpected end of/i.test(msg)) return 'malformed';
  if (/tool|function call|tool_call/i.test(msg)) return 'tool_failure';
  return 'unknown';
}

/**
 * Best-effort repair of malformed/truncated JSON returned by an LLM.
 * - Strips ```json fences and stray prose around the first {...} or [...] block
 * - Closes unbalanced braces/brackets at the end
 * - Removes trailing commas
 * Returns the parsed object on success, or null if irreparable.
 */
export function repairJson<T = any>(raw: string): T | null {
  if (!raw || typeof raw !== 'string') return null;

  // Quick path
  try { return JSON.parse(raw) as T; } catch { /* try repair */ }

  let s = raw.trim();

  // Strip code fences
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // Extract first JSON-looking block
  const firstBrace = s.indexOf('{');
  const firstBracket = s.indexOf('[');
  let start = -1;
  if (firstBrace === -1) start = firstBracket;
  else if (firstBracket === -1) start = firstBrace;
  else start = Math.min(firstBrace, firstBracket);
  if (start === -1) return null;
  s = s.slice(start);

  // Remove trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, '$1');

  // Balance braces / brackets / quotes
  let inString = false;
  let escape = false;
  let openCurly = 0;
  let openSquare = 0;
  for (const ch of s) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') openCurly++;
    else if (ch === '}') openCurly--;
    else if (ch === '[') openSquare++;
    else if (ch === ']') openSquare--;
  }
  if (inString) s += '"';
  while (openSquare-- > 0) s += ']';
  while (openCurly-- > 0) s += '}';

  try { return JSON.parse(s) as T; } catch { return null; }
}
