// Safety-mode gate. When a company is in `sales_mode = 'safety_only'` (or the
// swarm circuit breaker has tripped), the AI must NOT author customer-facing
// outbound. The only allowed actions are research + owner notifications.
//
// Import this from every outbound dispatcher and call assertOutboundAllowed
// before doing any provider call.

const OWNER_ONLY_TOOLS = new Set([
  "notify_boss",
  "bms_who_owes",
  "send_message", // only with recipient_type='owner'
]);

export interface SafetyContext {
  company_id: string;
  sales_mode?: string | null;
  circuit_breaker_open?: boolean | null;
}

export function isSafetyOnly(ctx: SafetyContext): boolean {
  return ctx.sales_mode === "safety_only" || ctx.circuit_breaker_open === true;
}

export interface OutboundCheck {
  tool: string;
  recipient_type?: "owner" | "customer" | string;
}

/**
 * Throws if the requested outbound is not allowed under safety-only mode.
 * Pass-through when safety-only is not in effect.
 */
export function assertOutboundAllowed(ctx: SafetyContext, check: OutboundCheck): void {
  if (!isSafetyOnly(ctx)) return;

  if (!OWNER_ONLY_TOOLS.has(check.tool)) {
    throw new Error(
      `[safety-mode-gate] Tool '${check.tool}' is blocked while company ${ctx.company_id} is in safety-only mode.`,
    );
  }
  if (check.tool === "send_message" && check.recipient_type !== "owner") {
    throw new Error(
      `[safety-mode-gate] send_message blocked: safety-only mode only permits owner recipients.`,
    );
  }
}
