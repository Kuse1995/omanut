import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export interface AdminAuditParams {
  eventType: string;
  message: string;
  companyId?: string | null;
  severity?: "info" | "warning" | "error" | "critical";
  details?: Record<string, unknown>;
}

/**
 * Records an admin control-plane action to public.security_events.
 * Non-throwing so audit failures never block operator workflows.
 */
export async function logAdminAction(params: AdminAuditParams): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    await supabase.from("security_events").insert({
      source: "admin_ui",
      event_type: params.eventType,
      severity: params.severity ?? "info",
      company_id: params.companyId ?? null,
      user_id: user?.id ?? null,
      message: params.message,
      details: (params.details ?? {}) as Json,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
  } catch (err) {
    console.warn("[adminAudit] Failed to log admin action:", err);
  }
}
