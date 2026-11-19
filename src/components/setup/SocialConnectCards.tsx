import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Linkedin, Music2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import IntegrationCard, { IntegrationStatus } from "@/components/setup/IntegrationCard";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/context/CompanyContext";
import { useToast } from "@/hooks/use-toast";

type Platform = "linkedin" | "tiktok";
type Connection = {
  platform: string;
  account_name: string | null;
  token_expires_at: string | null;
  environment: string;
};

// Safe columns only: tokens are not readable from the browser.
const SAFE_COLUMNS = "platform, account_name, token_expires_at, environment, updated_at";

export const SocialConnectCards = () => {
  const { selectedCompany } = useCompany();
  const companyId = selectedCompany?.id;
  const { toast } = useToast();

  const { data: connections = [], refetch } = useQuery<Connection[]>({
    queryKey: ["social-connections", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("social_credentials")
        .select(SAFE_COLUMNS)
        .eq("company_id", companyId!)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Connection[];
    },
  });

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.source === "social-oauth" && e.data?.ok) {
        refetch();
        toast({ title: `${e.data.platform === "linkedin" ? "LinkedIn" : "TikTok"} connected` });
      }
    };
    const onFocus = () => refetch();
    window.addEventListener("message", onMessage);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("focus", onFocus);
    };
  }, [refetch, toast]);

  const connect = async (platform: Platform) => {
    if (!companyId) return;
    // Open the window synchronously so popup blockers allow it.
    const popup = window.open("about:blank", `${platform}-oauth`, "width=600,height=720");
    const { data, error } = await supabase.functions.invoke("social-oauth-start", { body: { platform, company_id: companyId } });
    if (error || !data?.authorize_url) {
      popup?.close();
      let message = error?.message ?? "Could not start the connection.";
      if (error instanceof FunctionsHttpError) {
        try {
          message = (await error.context.json())?.error?.message || message;
        } catch { /* keep default */ }
      }
      toast({ title: "Couldn't start connection", description: message, variant: "destructive" });
      return;
    }
    if (popup) popup.location.href = data.authorize_url;
    else window.location.href = data.authorize_url;
  };

  const statusOf = (c?: Connection): IntegrationStatus => {
    if (!c) return "not_set_up";
    if (c.token_expires_at && Date.parse(c.token_expires_at) < Date.now() && c.platform === "linkedin") return "action_needed";
    return "connected";
  };

  const li = connections.find((c) => c.platform === "linkedin");
  const tt = connections.find((c) => c.platform === "tiktok");
  const liStatus = statusOf(li);
  const ttStatus = statusOf(tt);

  return (
    <>
      <IntegrationCard
        icon={Linkedin}
        iconBg="bg-sky-500/10"
        iconColor="text-sky-700"
        title="LinkedIn"
        description={
          liStatus === "connected"
            ? `Posting as ${li?.account_name ?? "your LinkedIn profile"}.`
            : liStatus === "action_needed"
              ? "Your LinkedIn sign-in expired. Reconnect to keep posting."
              : "Connect a LinkedIn profile so posts can go out there too."
        }
        status={liStatus}
        statusLabel={liStatus === "action_needed" ? "Reconnect" : undefined}
        rightSlot={
          <Button size="sm" variant={liStatus === "connected" ? "outline" : "default"} onClick={() => connect("linkedin")} className="flex-shrink-0">
            {liStatus === "not_set_up" ? "Connect LinkedIn" : "Reconnect"}
          </Button>
        }
      />
      <IntegrationCard
        icon={Music2}
        iconBg="bg-muted"
        iconColor="text-foreground"
        title="TikTok"
        description={
          ttStatus === "connected"
            ? `Connected as ${tt?.account_name ?? "your TikTok account"}${tt?.environment === "sandbox" ? " (sandbox: private posts only)" : ""}.`
            : "Connect a TikTok account to send videos and photo posts to it."
        }
        status={ttStatus}
        rightSlot={
          <Button size="sm" variant={ttStatus === "connected" ? "outline" : "default"} onClick={() => connect("tiktok")} className="flex-shrink-0">
            {ttStatus === "not_set_up" ? "Connect TikTok" : "Reconnect"}
          </Button>
        }
      />
    </>
  );
};

export default SocialConnectCards;
