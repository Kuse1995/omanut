import { Linkedin, Music2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import IntegrationCard from "@/components/setup/IntegrationCard";
import { useToast } from "@/hooks/use-toast";
import { useSocialConnections, type SocialPlatform } from "@/hooks/useSocialConnections";

export const SocialConnectCards = () => {
  const { toast } = useToast();
  const { connect, linkedin, tiktok, linkedinStatus, tiktokStatus } = useSocialConnections({
    onError: (message) =>
      toast({ title: "Couldn't start connection", description: message, variant: "destructive" }),
    onConnected: (platform: SocialPlatform) =>
      toast({ title: `${platform === "linkedin" ? "LinkedIn" : "TikTok"} connected` }),
  });

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
