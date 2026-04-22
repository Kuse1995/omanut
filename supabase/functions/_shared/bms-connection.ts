import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface BmsConnection {
  bridge_url: string;
  api_secret: string;
  bms_type: "single_tenant" | "multi_tenant";
  tenant_id: string | null;
  is_active: boolean;
}

const FINCH_BRIDGE_URL = "https://hnyzymyfirumjclqheit.supabase.co/functions/v1/bms-api-bridge";

// In-memory cache to avoid hitting the DB on every WhatsApp message.
// 5-minute TTL — short enough that toggling a connection in admin takes effect quickly,
// long enough to absorb message bursts.
interface CacheEntry {
  conn: BmsConnection | null;
  expiresAt: number;
}
const CACHE_TTL_MS = 5 * 60 * 1000;
// Cache key is namespaced by a per-cold-start nonce so a redeploy auto-invalidates
// any stale entries in the previous worker's memory. (Edge Function cold starts give
// each worker a fresh module scope, so this nonce is regenerated per deploy.)
const CACHE_NAMESPACE = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const connectionCache = new Map<string, CacheEntry>();
function cacheKey(companyId: string): string {
  return `${CACHE_NAMESPACE}:${companyId}`;
}

export function invalidateBmsConnectionCache(companyId?: string): void {
  if (companyId) connectionCache.delete(companyId);
  else connectionCache.clear();
}

/**
 * Load BMS connection config for a company.
 * Falls back to global env vars (Finch backward compat) if no record exists.
 * Cached for 5 minutes per company.
 */
export async function loadBmsConnection(
  supabase: SupabaseClient,
  companyId: string
): Promise<BmsConnection | null> {
  const cached = connectionCache.get(companyId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.conn;
  }

  const { data, error } = await supabase
    .from("bms_connections")
    .select("bridge_url, api_secret, bms_type, tenant_id, is_active")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error("[BMS-CONNECTION] DB error:", error.message);
  }

  let conn: BmsConnection | null = null;
  if (data) {
    conn = {
      bridge_url: data.bridge_url,
      api_secret: data.api_secret,
      bms_type: data.bms_type as "single_tenant" | "multi_tenant",
      tenant_id: data.tenant_id,
      is_active: data.is_active,
    };
  }
  // SECURITY: no global env-var fallback. A company without its own active
  // bms_connections row gets null — callers must handle that explicitly rather
  // than be silently routed to another tenant's BMS.

  connectionCache.set(companyId, { conn, expiresAt: Date.now() + CACHE_TTL_MS });
  return conn;
}

/**
 * Look up a company by tenant_id in bms_connections (for incoming webhooks).
 * Returns company_id and api_secret for validation.
 */
export async function lookupCompanyByTenantId(
  supabase: SupabaseClient,
  tenantId: string
): Promise<{ company_id: string; api_secret: string } | null> {
  const { data, error } = await supabase
    .from("bms_connections")
    .select("company_id, api_secret")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error("[BMS-CONNECTION] Tenant lookup error:", error.message);
    return null;
  }

  return data ? { company_id: data.company_id, api_secret: data.api_secret } : null;
}
