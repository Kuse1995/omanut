import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface BmsConnection {
  bridge_url: string;
  api_secret: string;
  bms_type: "single_tenant" | "multi_tenant";
  tenant_id: string | null;
  is_active: boolean;
}

const FINCH_BRIDGE_URL = "https://hnyzymyfirumjclqheit.supabase.co/functions/v1/bms-api-bridge";

/**
 * Load BMS connection config for a company.
 * Falls back to global env vars (Finch backward compat) if no record exists.
 */
export async function loadBmsConnection(
  supabase: SupabaseClient,
  companyId: string
): Promise<BmsConnection | null> {
  const { data, error } = await supabase
    .from("bms_connections")
    .select("bridge_url, api_secret, bms_type, tenant_id, is_active")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error("[BMS-CONNECTION] DB error:", error.message);
  }

  if (data) {
    return {
      bridge_url: data.bridge_url,
      api_secret: data.api_secret,
      bms_type: data.bms_type as "single_tenant" | "multi_tenant",
      tenant_id: data.tenant_id,
      is_active: data.is_active,
    };
  }

  // Fallback: global env vars (Finch single-tenant)
  const globalSecret = Deno.env.get("BMS_API_SECRET");
  if (!globalSecret) return null;

  return {
    bridge_url: FINCH_BRIDGE_URL,
    api_secret: globalSecret,
    bms_type: "single_tenant",
    tenant_id: null,
    is_active: true,
  };
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
