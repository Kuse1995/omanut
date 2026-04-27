import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/context/CompanyContext";

export interface SetupStatus {
  whatsapp: "connected" | "action_needed" | "not_set_up";
  meta: "connected" | "action_needed" | "not_set_up";
  payments: "connected" | "action_needed" | "not_set_up";
  bms: "connected" | "action_needed" | "not_set_up";
  ai: "connected" | "action_needed" | "not_set_up";
  brand: "connected" | "action_needed" | "not_set_up";
  whatsappLabel?: string;
  metaCount: number;
  paymentsCount: number;
}

/**
 * One query that fetches everything the Setup hub + checklist need.
 * Keeps the hub consistent with the dashboard widget.
 */
export const useSetupStatus = () => {
  const { selectedCompany } = useCompany();
  const companyId = selectedCompany?.id;

  return useQuery<SetupStatus>({
    queryKey: ["setup-status", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      if (!companyId) throw new Error("No company");

      const [companyRes, metaRes, waCloudRes, paymentsRes, aiRes, brandRes] = await Promise.all([
        supabase
          .from("companies")
          .select("whatsapp_number, twilio_number, whatsapp_provider, business_type, voice_style")
          .eq("id", companyId)
          .single(),
        supabase
          .from("meta_credentials")
          .select("id, health_status", { count: "exact" })
          .eq("company_id", companyId),
        supabase
          .from("company_whatsapp_cloud")
          .select("display_phone_number, health_status")
          .eq("company_id", companyId)
          .maybeSingle(),
        supabase
          .from("payment_products")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("is_active", true),
        supabase
          .from("company_ai_overrides")
          .select("system_instructions, primary_model")
          .eq("company_id", companyId)
          .maybeSingle(),
        supabase
          .from("company_media")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId),
      ]);

      const company = companyRes.data;
      const metaCount = metaRes.count ?? metaRes.data?.length ?? 0;
      const metaUnhealthy = (metaRes.data ?? []).some((m) => m.health_status && m.health_status !== "healthy");
      const waCloud = waCloudRes.data;
      const paymentsCount = paymentsRes.count ?? 0;

      // BMS: stored on companies.metadata.bms.tenant_id
      const { data: bmsRes } = await supabase
        .from("companies")
        .select("metadata")
        .eq("id", companyId)
        .maybeSingle();
      const meta = (bmsRes?.metadata as any) ?? {};
      const bmsConfigured = Boolean(meta?.bms_tenant_id) || Boolean(meta?.bms?.tenant_id);

      const whatsappConnected = Boolean(company?.whatsapp_number) || Boolean(waCloud?.display_phone_number);
      const whatsappLabel = waCloud?.display_phone_number
        ? `Direct via Meta · ${waCloud.display_phone_number}`
        : company?.whatsapp_number
          ? `via Twilio · ${company.whatsapp_number.replace("whatsapp:", "")}`
          : undefined;

      return {
        whatsapp: whatsappConnected ? "connected" : "not_set_up",
        meta:
          metaCount === 0
            ? "not_set_up"
            : metaUnhealthy
              ? "action_needed"
              : "connected",
        payments: paymentsCount > 0 ? "connected" : "not_set_up",
        bms: bmsConfigured ? "connected" : "not_set_up",
        ai: aiRes.data?.system_instructions ? "connected" : "action_needed",
        brand: (brandRes.count ?? 0) > 0 ? "connected" : "not_set_up",
        whatsappLabel,
        metaCount,
        paymentsCount,
      };
    },
  });
};
