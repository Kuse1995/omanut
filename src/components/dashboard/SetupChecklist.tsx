import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRight } from "lucide-react";
import { useSetupStatus } from "@/hooks/useSetupStatus";

/**
 * Compact setup-progress widget for the Dashboard. Hides itself once everything is green.
 */
const SetupChecklist = () => {
  const navigate = useNavigate();
  const { data: status } = useSetupStatus();

  if (!status) return null;

  const total = 6;
  const completed = [
    status.whatsapp,
    status.meta,
    status.payments,
    status.bms,
    status.ai,
    status.brand,
  ].filter((s) => s === "connected").length;

  if (completed === total) return null;

  const pct = Math.round((completed / total) * 100);
  const next = !status.whatsapp.includes("connected")
    ? "Connect WhatsApp"
    : status.meta !== "connected"
      ? "Connect Facebook & Instagram"
      : status.ai !== "connected"
        ? "Customize your AI personality"
        : status.payments !== "connected"
          ? "Add products to start selling"
          : status.brand !== "connected"
            ? "Upload your brand kit"
            : "Link your business system";

  return (
    <Card className="mb-6 border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="font-semibold">Finish setting up your assistant</p>
              <span className="text-sm font-medium text-primary">{completed}/{total}</span>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">Next: {next}</p>

            <div className="mt-3 h-1.5 w-full bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>

            <Button
              size="sm"
              onClick={() => navigate("/setup")}
              className="mt-3 gap-1"
            >
              Continue setup <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default SetupChecklist;
