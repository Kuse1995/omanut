/**
 * Security Event Logging Utilities for Edge Functions
 * 
 * Use these to log security-relevant events for auditing,
 * incident response, and compliance purposes.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type SecurityEventType = 
  | 'tenant_violation'
  | 'tenant_mismatch'
  | 'auth_failure'
  | 'role_insufficient'
  | 'suspicious_access'
  | 'rate_limit_exceeded'
  | 'invalid_request';

export type SecuritySeverity = 'info' | 'warning' | 'error' | 'critical';

export interface SecurityEventData {
  eventType: SecurityEventType;
  severity: SecuritySeverity;
  source: string;
  message: string;
  companyId?: string | null;
  userId?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Log a security event to the security_events table.
 * Should be called with a service role client.
 * 
 * @param supabase - Supabase client with service role
 * @param event - Security event data
 */
export async function logSecurityEvent(
  supabase: SupabaseClient,
  event: SecurityEventData
): Promise<void> {
  try {
    const { error } = await supabase
      .from('security_events')
      .insert({
        event_type: event.eventType,
        severity: event.severity,
        source: event.source,
        message: event.message,
        company_id: event.companyId || null,
        user_id: event.userId || null,
        details: event.details || {},
        ip_address: event.ipAddress || null,
        user_agent: event.userAgent || null,
      });

    if (error) {
      // Don't throw - security logging should not break the main flow
      console.error('Failed to log security event:', error);
    }
  } catch (err) {
    console.error('Error logging security event:', err);
  }
}

/**
 * Log a tenant isolation violation.
 * These are high-priority security events.
 */
export async function logTenantViolation(
  supabase: SupabaseClient,
  source: string,
  message: string,
  details?: Record<string, unknown>
): Promise<void> {
  console.error(`SECURITY: Tenant violation in ${source}: ${message}`);
  
  await logSecurityEvent(supabase, {
    eventType: 'tenant_violation',
    severity: 'critical',
    source,
    message,
    details: {
      ...details,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Log a tenant mismatch (less severe than violation).
 */
export async function logTenantMismatch(
  supabase: SupabaseClient,
  source: string,
  expectedCompanyId: string,
  actualCompanyId: string | null,
  details?: Record<string, unknown>
): Promise<void> {
  const message = `Expected company ${expectedCompanyId} but found ${actualCompanyId}`;
  console.error(`SECURITY: Tenant mismatch in ${source}: ${message}`);
  
  await logSecurityEvent(supabase, {
    eventType: 'tenant_mismatch',
    severity: 'error',
    source,
    message,
    companyId: expectedCompanyId,
    details: {
      expected_company_id: expectedCompanyId,
      actual_company_id: actualCompanyId,
      ...details,
    },
  });
}

/**
 * Log an insufficient role access attempt.
 */
export async function logInsufficientRole(
  supabase: SupabaseClient,
  source: string,
  requiredRole: string,
  companyId: string,
  userId?: string
): Promise<void> {
  const message = `User lacks required role: ${requiredRole}`;
  console.warn(`SECURITY: Insufficient role in ${source}: ${message}`);
  
  await logSecurityEvent(supabase, {
    eventType: 'role_insufficient',
    severity: 'warning',
    source,
    message,
    companyId,
    userId,
    details: {
      required_role: requiredRole,
    },
  });
}

/**
 * Extract client info from request for logging.
 */
export function extractClientInfo(req: Request): { ipAddress?: string; userAgent?: string } {
  return {
    ipAddress: req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || undefined,
    userAgent: req.headers.get('user-agent') || undefined,
  };
}
