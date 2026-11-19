import { useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/context/CompanyContext";
import type { IntegrationStatus } from "@/components/setup/IntegrationCard";

export type SocialPlatform = "linkedin" | "tiktok";

export type SocialConnection = {
  platform: string;
  account_name: string | null;
  token_expires_at: string | null;
  environment: string;
  updated_at: string | null;
};

// Safe columns only: access/refresh tokens are never readable from the browser.
const SAFE_COLUMNS = "platform, account_name, token_expires_at, environment, updated_at";

interface UseSocialConnectionsOptions {
  /** Called with a human-readable message when a connection cannot be started. */
  onError?: (message: string) => void;
  /** Called when a provider popup reports a successful connection. */
  onConnected?: (platform: SocialPlatform) => void;
}

/**
 * LinkedIn / TikTok connections for the active company, plus the one-click
 * connect flow. Shared by the Setup checklist cards and the Social Integrations
 * panel so both surfaces behave identically.
 */
export const useSocialConnections = (options: UseSocialConnectionsOptions = {}) => {
  const { onError, onConnected } = options;
  const { selectedCompany } = useCompany();
  const companyId = selectedCompany?.id;

  const { data: connections = [], refetch } = useQuery<SocialConnection[]>({
    queryKey: ["social-connections", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("social_credentials")
        .select(SAFE_COLUMNS)
        .eq("company_id", companyId!)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SocialConnection[];
    },
  });

  // A completed provider popup tells us directly; a closed/abandoned popup is
  // caught when the window regains focus.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.source === "social-oauth" && e.data?.ok) {
        refetch();
        onConnected?.(e.data.platform as SocialPlatform);
      }
    };
    const onFocus = () => refetch();
    window.addEventListener("message", onMessage);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("focus", onFocus);
    };
  }, [refetch, onConnected]);

  const connect = useCallback(
    async (platform: SocialPlatform) => {
      if (!companyId) {
        onError?.("Pick a business first.");
        return;
      }
      // Open the window synchronously so popup blockers allow it.
      const popup = window.open("about:blank", `${platform}-oauth`, "width=600,height=720");
      const { data, error } = await supabase.functions.invoke("social-oauth-start", {
        body: { platform, company_id: companyId },
      });
      if (error || !data?.authorize_url) {
        popup?.close();
        let message = error?.message ?? "Could not start the connection.";
        if (error instanceof FunctionsHttpError) {
          try {
            message = (await error.context.json())?.error?.message || message;
          } catch {
            /* keep default */
          }
        }
        onError?.(message);
        return;
      }
      if (popup) popup.location.href = data.authorize_url;
      else window.location.href = data.authorize_url;
    },
    [companyId, onError],
  );

  const statusOf = useCallback((c?: SocialConnection): IntegrationStatus => {
    if (!c) return "not_set_up";
    if (
      c.token_expires_at &&
      Date.parse(c.token_expires_at) < Date.now() &&
      c.platform === "linkedin"
    ) {
      return "action_needed";
    }
    return "connected";
  }, []);

  const linkedin = connections.find((c) => c.platform === "linkedin");
  const tiktok = connections.find((c) => c.platform === "tiktok");

  return {
    connections,
    refetch,
    connect,
    statusOf,
    linkedin,
    tiktok,
    linkedinStatus: statusOf(linkedin),
    tiktokStatus: statusOf(tiktok),
    hasCompany: !!companyId,
  };
};

export default useSocialConnections;
