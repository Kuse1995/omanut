import { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, Circle, ChevronRight, LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type IntegrationStatus = "connected" | "action_needed" | "not_set_up";

interface IntegrationCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  status: IntegrationStatus;
  statusLabel?: string;
  onClick?: () => void;
  iconBg?: string;
  iconColor?: string;
  rightSlot?: ReactNode;
}

const statusConfig: Record<
  IntegrationStatus,
  { label: string; Icon: LucideIcon; variant: "default" | "secondary" | "outline"; cls: string }
> = {
  connected: {
    label: "Live",
    Icon: CheckCircle2,
    variant: "secondary",
    cls: "text-green-600 border-green-500/30 bg-green-500/10",
  },
  action_needed: {
    label: "Action needed",
    Icon: AlertTriangle,
    variant: "secondary",
    cls: "text-amber-600 border-amber-500/30 bg-amber-500/10",
  },
  not_set_up: {
    label: "Not connected",
    Icon: Circle,
    variant: "outline",
    cls: "text-muted-foreground border-border",
  },
};

export const IntegrationCard = ({
  icon: Icon,
  title,
  description,
  status,
  statusLabel,
  onClick,
  iconBg = "bg-primary/10",
  iconColor = "text-primary",
  rightSlot,
}: IntegrationCardProps) => {
  const cfg = statusConfig[status];
  const StatusIcon = cfg.Icon;

  return (
    <Card
      onClick={onClick}
      className={cn(
        "border-border bg-card/50 transition-all",
        onClick && "cursor-pointer hover:border-primary/40 hover:bg-card",
      )}
    >
      <CardContent className="flex items-center gap-4 p-4 sm:p-5">
        <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0", iconBg)}>
          <Icon className={cn("w-6 h-6", iconColor)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-base text-foreground truncate">{title}</h3>
            <Badge variant="outline" className={cn("text-xs gap-1 font-normal", cfg.cls)}>
              <StatusIcon className="w-3 h-3" />
              {statusLabel ?? cfg.label}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{description}</p>
        </div>
        {rightSlot ?? (onClick && <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />)}
      </CardContent>
    </Card>
  );
};

export default IntegrationCard;
