import { Building2, Linkedin, Music2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import IntegrationCard from "@/components/setup/IntegrationCard";
import { useToast } from "@/hooks/use-toast";
import { useSocialConnections, type SocialPlatform } from "@/hooks/useSocialConnections";

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  linkedin: "LinkedIn",
  linkedin_pages: "LinkedIn Company Page",
  tiktok: "TikTok",
};

export const SocialConnectCards = () => {
  const { toast } = useToast();
  const { connect, linkedin, linkedinPage, linkedinPages, tiktok, linkedinStatus, linkedinPagesStatus, tiktokStatus } = useSocialConnections({
    onError: (message) =>
      toast({ title: "Couldn't start connection", description: message, variant: "destructive" }),
    onConnected: (platform: SocialPlatform) =>
      toast({ title: `${PLATFORM_LABEL[platform] ?? "Account"} connected` }),
  });

  const pageNames = linkedinPages.map((p) => p.account_name).filter(Boolean).join(", ");

  return (
    <>
      <IntegrationCard
        icon={Linkedin}
        iconBg="bg-sky-500/10"
        iconColor="text-sky-700 dark:text-sky-400"
        title="LinkedIn"
        description={
          linkedinStatus === "connected"
            ? `Posting as ${linkedin?.account_name ?? "your LinkedIn profile"}.`
            : linkedinStatus === "action_needed"
              ? "Your LinkedIn sign-in expired. Reconnect to keep posting."
              : "Connect a LinkedIn profile so posts can go out there too."
        }
        status={linkedinStatus}
        statusLabel={linkedinStatus === "action_needed" ? "Reconnect" : undefined}
        rightSlot={
          <Button
            size="sm"
            variant={linkedinStatus === "connected" ? "outline" : "default"}
            onClick={() => connect("linkedin")}
            className="flex-shrink-0"
            aria-label={linkedinStatus === "not_set_up" ? "Connect LinkedIn" : "Reconnect LinkedIn"}
          >
            {linkedinStatus === "not_set_up" ? (
              <>
                <span className="sm:hidden">Connect</span>
                <span className="hidden sm:inline">Connect LinkedIn</span>
              </>
            ) : (
              "Reconnect"
            )}
          </Button>
        }
      />
      <IntegrationCard
        icon={Building2}
        iconBg="bg-sky-500/10"
        iconColor="text-sky-700 dark:text-sky-400"
        title="LinkedIn Company Page"
        description={
          linkedinPagesStatus === "connected"
            ? `Posting to ${pageNames || linkedinPage?.account_name || "your Company Page"}.`
            : linkedinPagesStatus === "action_needed"
              ? "Your LinkedIn Page sign-in expired. Reconnect to keep posting."
              : "Connect an organization Page (requires Community Management API)."
        }
        status={linkedinPagesStatus}
        statusLabel={linkedinPagesStatus === "action_needed" ? "Reconnect" : undefined}
        rightSlot={
          <Button
            size="sm"
            variant={linkedinPagesStatus === "connected" ? "outline" : "default"}
            onClick={() => connect("linkedin_pages")}
            className="flex-shrink-0"
            aria-label={linkedinPagesStatus === "not_set_up" ? "Connect LinkedIn Page" : "Reconnect LinkedIn Page"}
          >
            {linkedinPagesStatus === "not_set_up" ? (
              <>
                <span className="sm:hidden">Connect</span>
                <span className="hidden sm:inline">Connect Page</span>
              </>
            ) : (
              "Reconnect"
            )}
          </Button>
        }
      />
      <IntegrationCard
        icon={Music2}
        iconBg="bg-muted"
        iconColor="text-foreground"
        title="TikTok"
        description={
          tiktokStatus === "connected"
            ? `Connected as ${tiktok?.account_name ?? "your TikTok account"}${
                tiktok?.environment === "sandbox" ? " (sandbox: private posts only)" : ""
              }.`
            : "Connect a TikTok account to send videos and photo posts to it."
        }
        status={tiktokStatus}
        rightSlot={
          <Button
            size="sm"
            variant={tiktokStatus === "connected" ? "outline" : "default"}
            onClick={() => connect("tiktok")}
            className="flex-shrink-0"
            aria-label={tiktokStatus === "not_set_up" ? "Connect TikTok" : "Reconnect TikTok"}
          >
            {tiktokStatus === "not_set_up" ? (
              <>
                <span className="sm:hidden">Connect</span>
                <span className="hidden sm:inline">Connect TikTok</span>
              </>
            ) : (
              "Reconnect"
            )}
          </Button>
        }
      />
    </>
  );
};

export default SocialConnectCards;
