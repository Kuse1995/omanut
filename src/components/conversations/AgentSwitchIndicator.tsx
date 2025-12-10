import { cn } from '@/lib/utils';
import { RefreshCw, Headset, TrendingUp, UserCircle } from 'lucide-react';

interface AgentSwitchIndicatorProps {
  agentType: string;
  notes?: string;
}

export const AgentSwitchIndicator = ({ agentType, notes }: AgentSwitchIndicatorProps) => {
  const isSwitch = notes?.includes('Agent switch:');
  
  const getAgentInfo = () => {
    switch (agentType) {
      case 'support': 
        return { 
          label: 'Support Agent', 
          icon: Headset,
          bgClass: 'bg-blue-500/10 border-blue-500/20',
          textClass: 'text-blue-400'
        };
      case 'sales': 
        return { 
          label: 'Sales Agent', 
          icon: TrendingUp,
          bgClass: 'bg-emerald-500/10 border-emerald-500/20',
          textClass: 'text-emerald-400'
        };
      case 'boss': 
        return { 
          label: 'Human Handoff', 
          icon: UserCircle,
          bgClass: 'bg-amber-500/10 border-amber-500/20',
          textClass: 'text-amber-400'
        };
      default: 
        return { 
          label: agentType, 
          icon: RefreshCw,
          bgClass: 'bg-muted border-border',
          textClass: 'text-muted-foreground'
        };
    }
  };

  const agentInfo = getAgentInfo();
  const Icon = agentInfo.icon;

  return (
    <div className="flex justify-center my-4">
      <div className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-medium",
        agentInfo.bgClass
      )}>
        {isSwitch && <RefreshCw className={cn("h-3 w-3", agentInfo.textClass)} />}
        <Icon className={cn("h-3.5 w-3.5", agentInfo.textClass)} />
        <span className={agentInfo.textClass}>
          {isSwitch ? 'Switched to ' : 'Routed to '}
          <span className="font-semibold">{agentInfo.label}</span>
        </span>
      </div>
    </div>
  );
};
