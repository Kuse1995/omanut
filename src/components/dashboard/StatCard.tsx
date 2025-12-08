import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  onClick?: () => void;
}

const StatCard = ({ 
  title, 
  value, 
  description, 
  icon: Icon, 
  trend,
  trendValue,
  onClick 
}: StatCardProps) => {
  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative p-6 rounded-2xl border border-border bg-card/50 hover:bg-card hover:border-primary/30 transition-all duration-300",
        onClick && "cursor-pointer"
      )}
    >
      {/* Glow Effect */}
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      
      <div className="relative">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm text-muted-foreground">{title}</span>
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            <Icon className="w-5 h-5" />
          </div>
        </div>
        
        <div className="flex items-end justify-between">
          <div>
            <p className="text-3xl font-bold tracking-tight">{value}</p>
            {description && (
              <p className="text-xs text-muted-foreground mt-1">{description}</p>
            )}
          </div>
          
          {trend && trendValue && (
            <div className={cn(
              "flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full",
              trend === "up" && "bg-green-500/10 text-green-500",
              trend === "down" && "bg-red-500/10 text-red-500",
              trend === "neutral" && "bg-muted text-muted-foreground"
            )}>
              {trend === "up" && <TrendingUp className="w-3 h-3" />}
              {trend === "down" && <TrendingDown className="w-3 h-3" />}
              {trend === "neutral" && <Minus className="w-3 h-3" />}
              {trendValue}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StatCard;
