/**
 * Structured error taxonomy for BMS operations.
 * Lets the AI + dashboards reason about failure categories instead of parsing free text.
 */

export type BmsErrorCode =
  | "OK"
  | "RBAC_DENIED"        // BMS rejected the call due to role/permissions
  | "AUTH_FAILED"         // bad / missing / expired api secret
  | "TIMEOUT"             // hit our abort timeout
  | "NETWORK"             // fetch failed (DNS, refused, etc.)
  | "BMS_DOWN"            // upstream 5xx
  | "RATE_LIMITED"        // 429
  | "NOT_FOUND"           // resource not found (4xx with not-found semantics)
  | "VALIDATION"          // 400 — bad params
  | "CIRCUIT_OPEN"        // local circuit breaker fired
  | "UNKNOWN";

export interface BmsErrorEnvelope {
  success: false;
  code: BmsErrorCode;
  message: string;
  retriable: boolean;
  hint?: string;
  http_status?: number;
}

export interface BmsSuccessEnvelope {
  success: true;
  data: any;
  code: "OK";
}

export type BmsResult = BmsErrorEnvelope | BmsSuccessEnvelope;

/**
 * Map an HTTP response + body to a structured error code.
 */
export function classifyHttpError(status: number, bodyText: string): { code: BmsErrorCode; retriable: boolean; hint?: string } {
  const lower = (bodyText || "").toLowerCase();

  if (status === 401 || status === 403) {
    if (lower.includes("rbac") || lower.includes("permission") || lower.includes("forbidden") || lower.includes("not allowed")) {
      return { code: "RBAC_DENIED", retriable: false, hint: "The connected BMS account lacks permission for this action. Hand off to a human." };
    }
    return { code: "AUTH_FAILED", retriable: false, hint: "BMS API secret is invalid or expired." };
  }

  if (status === 404) {
    return { code: "NOT_FOUND", retriable: false };
  }

  if (status === 429) {
    return { code: "RATE_LIMITED", retriable: true, hint: "BMS bridge is rate-limiting us. Backoff and retry." };
  }

  if (status === 400 || status === 422) {
    return { code: "VALIDATION", retriable: false, hint: "Check the parameters sent to BMS." };
  }

  if (status >= 500 && status < 600) {
    return { code: "BMS_DOWN", retriable: true, hint: "BMS upstream is having issues. Tell the customer honestly." };
  }

  return { code: "UNKNOWN", retriable: false };
}

/**
 * Map a thrown fetch / network error to a structured code.
 */
export function classifyTransportError(err: unknown): { code: BmsErrorCode; retriable: boolean; hint?: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes("abort") || lower.includes("timeout") || lower.includes("timed out")) {
    return { code: "TIMEOUT", retriable: true, hint: "BMS did not respond in time." };
  }
  return { code: "NETWORK", retriable: true, hint: "Could not reach BMS bridge." };
}

/**
 * Sleep helper for backoff.
 */
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Compute a stable idempotency key from inputs. Used so retries on timeout don't double-charge.
 */
export async function computeIdempotencyKey(
  companyId: string,
  conversationId: string | null,
  intent: string,
  params: Record<string, any>
): Promise<string> {
  // Canonicalize params: sort keys, drop volatile fields
  const cleaned: Record<string, any> = {};
  for (const k of Object.keys(params).sort()) {
    if (k === "company_id" || k === "idempotency_key") continue;
    cleaned[k] = params[k];
  }
  const payload = `${companyId}|${conversationId || ""}|${intent}|${JSON.stringify(cleaned)}`;
  const data = new TextEncoder().encode(payload);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Tools that mutate state in BMS — require idempotency protection.
 */
export const BMS_WRITE_INTENTS = new Set([
  "record_sale",
  "credit_sale",
  "create_invoice",
  "create_quotation",
  "create_order",
  "update_order_status",
  "cancel_order",
  "update_stock",
  "bulk_add_inventory",
  "create_contact",
  "record_expense",
  "generate_payment_link",
  "send_receipt",
  "send_invoice",
  "send_quotation",
  "send_payslip",
  "clock_in",
  "clock_out",
]);

/**
 * In-memory circuit breaker per company. Module-scope so it persists across calls in the same isolate.
 */
interface BreakerState {
  failures: number;
  openedAt: number | null;
  lastFailureAt: number;
}

const breakers = new Map<string, BreakerState>();
const FAILURE_WINDOW_MS = 60_000;
const FAILURE_THRESHOLD = 3;
const OPEN_DURATION_MS = 30_000;

export function isBreakerOpen(companyId: string): boolean {
  const b = breakers.get(companyId);
  if (!b || !b.openedAt) return false;
  if (Date.now() - b.openedAt > OPEN_DURATION_MS) {
    // half-open: allow one probe
    breakers.set(companyId, { failures: 0, openedAt: null, lastFailureAt: 0 });
    return false;
  }
  return true;
}

export function recordBreakerSuccess(companyId: string): void {
  breakers.delete(companyId);
}

export function recordBreakerFailure(companyId: string): void {
  const now = Date.now();
  const b = breakers.get(companyId) ?? { failures: 0, openedAt: null, lastFailureAt: now };
  // Reset counter if outside window
  if (now - b.lastFailureAt > FAILURE_WINDOW_MS) {
    b.failures = 0;
  }
  b.failures += 1;
  b.lastFailureAt = now;
  if (b.failures >= FAILURE_THRESHOLD && !b.openedAt) {
    b.openedAt = now;
    console.warn(`[BMS-BREAKER] Opened for company ${companyId} after ${b.failures} failures`);
  }
  breakers.set(companyId, b);
}
