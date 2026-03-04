import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { UserCog, Bot, Pin, Headset, TrendingUp, UserCircle, Facebook, MessageCircle, MessageSquare } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

interface ConversationItemProps {
  conversation: {
    id: string;
    customer_name: string | null;
    phone: string | null;
    started_at: string;
    status: string;
    human_takeover: boolean;
    unread_count: number;
    last_message_preview: string | null;
    pinned: boolean;
    messages: any[];
    active_agent?: string | null;
  };
  isSelected: boolean;
  onClick: () => void;
}

export const ConversationItem = ({ conversation, isSelected, onClick }: ConversationItemProps) => {
  const getInitials = () => {
    if (conversation.customer_name) {
      return conversation.customer_name.substring(0, 2).toUpperCase();
    }
    return conversation.phone?.substring(0, 2) || '??';
  };

  const getLastMessage = () => {
    if (conversation.last_message_preview) {
      return conversation.last_message_preview;
    }
    if (conversation.messages && conversation.messages.length > 0) {
      const lastMsg = conversation.messages[conversation.messages.length - 1];
      return lastMsg.content.substring(0, 50) + (lastMsg.content.length > 50 ? '...' : '');
    }
    return 'No messages yet';
  };

  const getAgentBadge = () => {
    if (conversation.human_takeover) {
      return (
        <Badge variant="secondary" className="gap-1 h-5 text-[10px] px-1.5">
          <UserCog className="h-3 w-3" />
          Human
        </Badge>
      );
    }
    
    switch (conversation.active_agent) {
      case 'support':
        return (
          <Badge className="gap-1 h-5 text-[10px] px-1.5 bg-blue-500/10 text-blue-500 border-blue-500/20 hover:bg-blue-500/20">
            <Headset className="h-3 w-3" />
            Support
          </Badge>
        );
      case 'sales':
        return (
          <Badge className="gap-1 h-5 text-[10px] px-1.5 bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20">
            <TrendingUp className="h-3 w-3" />
            Sales
          </Badge>
        );
      case 'boss':
        return (
          <Badge className="gap-1 h-5 text-[10px] px-1.5 bg-amber-500/10 text-amber-500 border-amber-500/20 hover:bg-amber-500/20">
            <UserCircle className="h-3 w-3" />
            Boss
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="gap-1 h-5 text-[10px] px-1.5">
            <Bot className="h-3 w-3" />
            AI
          </Badge>
        );
    }
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        "p-3 cursor-pointer transition-all duration-200 relative group",
        "hover:bg-accent/50",
        isSelected && "bg-accent border-l-2 border-l-primary"
      )}
    >
      <div className="flex gap-3">
        {/* Avatar with online indicator */}
        <div className="relative shrink-0">
          <Avatar className="h-11 w-11">
            <AvatarFallback className={cn(
              "font-semibold text-sm",
              isSelected ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"
            )}>
              {getInitials()}
            </AvatarFallback>
          </Avatar>
          {/* Platform icon */}
          {conversation.phone?.startsWith('fbdm:') ? (
            <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 bg-violet-600 rounded-full border-2 border-card flex items-center justify-center">
              <MessageSquare className="h-2.5 w-2.5 text-white" />
            </div>
          ) : conversation.phone?.startsWith('fb:') ? (
            <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 bg-blue-600 rounded-full border-2 border-card flex items-center justify-center">
              <Facebook className="h-2.5 w-2.5 text-white" />
            </div>
          ) : (
            <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 bg-emerald-500 rounded-full border-2 border-card flex items-center justify-center">
              <MessageCircle className="h-2.5 w-2.5 text-white" />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-0.5">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <h4 className={cn(
                "font-semibold text-sm truncate",
                conversation.unread_count > 0 && "text-foreground"
              )}>
                {conversation.customer_name || conversation.phone || 'Unknown'}
              </h4>
              {conversation.pinned && (
                <Pin className="h-3 w-3 text-primary shrink-0" />
              )}
            </div>
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {formatDistanceToNow(new Date(conversation.started_at), { addSuffix: false })}
            </span>
          </div>

          <p className={cn(
            "text-xs truncate mb-1.5",
            conversation.unread_count > 0 
              ? "text-foreground font-medium" 
              : "text-muted-foreground"
          )}>
            {getLastMessage()}
          </p>

          <div className="flex items-center justify-between">
            {getAgentBadge()}
            
            {conversation.unread_count > 0 && (
              <Badge className="h-5 min-w-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                {conversation.unread_count}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
