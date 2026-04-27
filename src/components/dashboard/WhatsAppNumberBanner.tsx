import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Check, Share2, MessageCircle, Clock } from "lucide-react";
import { useSetupStatus } from "@/hooks/useSetupStatus";
import { formatPhone } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";

interface Props {
  companyName?: string;
}

/**
 * Prominent customer-facing WhatsApp number, with copy + share affordances.
 * Twilio/Meta-WhatsApp config is owned by Omanut admins — clients only see + share.
 */
const WhatsAppNumberBanner = ({ companyName }: Props) => {
  const { data: status } = useSetupStatus();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  if (!status) return null;

  const rawNumber = status.whatsappLabel?.split("·").pop()?.trim() ?? "";
  const hasNumber = status.whatsapp === "connected" && rawNumber;

  if (!hasNumber) {
    return (
      <Card className="mb-6 border-dashed border-border bg-card/30">
        <CardContent className="flex items-center gap-3 p-4">
          <div className="w-10 h-10 rounded-xl bg-muted/50 flex items-center justify-center flex-shrink-0">
            <Clock className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">WhatsApp number pending</p>
            <p className="text-xs text-muted-foreground">
              We're provisioning a number for your business. You'll see it here once it's live.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const pretty = formatPhone(rawNumber) || rawNumber;
  const shareText = encodeURIComponent(
    `Chat with ${companyName ?? "us"} on WhatsApp: ${rawNumber}`,
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(rawNumber);
      setCopied(true);
      toast({ title: "Copied", description: "WhatsApp number copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  return (
    <Card className="mb-6 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardContent className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 sm:p-5">
        <div className="w-11 h-11 rounded-xl bg-green-500/10 flex items-center justify-center flex-shrink-0">
          <MessageCircle className="w-5 h-5 text-green-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            Share this with your customers
          </p>
          <p className="text-lg sm:text-xl font-mono font-semibold mt-0.5 truncate">
            {pretty}
          </p>
        </div>
        <div className="flex items-center gap-2 self-stretch sm:self-auto">
          <Button size="sm" variant="outline" onClick={copy} className="flex-1 sm:flex-none gap-1.5">
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            size="sm"
            onClick={() => window.open(`https://wa.me/?text=${shareText}`, "_blank")}
            className="flex-1 sm:flex-none gap-1.5"
          >
            <Share2 className="w-4 h-4" /> Share
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default WhatsAppNumberBanner;
