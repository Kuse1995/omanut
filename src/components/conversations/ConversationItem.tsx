import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { UserCog, Bot, Pin, Headset, TrendingUp, UserCircle } from 'lucide-react';
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

  return (
    <div
      onClick={onClick}
      className={cn(
        "p-4 cursor-pointer hover:bg-accent/50 transition-colors relative",
        isSelected && "bg-accent"
      )}
    >
      <div className="flex gap-3">
        {/* Avatar */}
        <Avatar className="h-12 w-12 shrink-0">
          <AvatarFallback className="bg-primary/10 text-primary font-semibold">
            {getInitials()}
          </AvatarFallback>
        </Avatar>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <h4 className="font-semibold text-sm truncate">
                {conversation.customer_name || conversation.phone || 'Unknown'}
              </h4>
              {conversation.pinned && (
                <Pin className="h-3 w-3 text-primary shrink-0" />
              )}
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {formatDistanceToNow(new Date(conversation.started_at), { addSuffix: true })}
            </span>
          </div>

          <p className="text-sm text-muted-foreground truncate mb-2">
            {getLastMessage()}
          </p>

          <div className="flex items-center gap-2 flex-wrap">
            {conversation.active_agent === 'support' && (
              <Badge variant="outline" className="gap-1 bg-green-50 text-green-700 border-green-200">
                <Headset className="h-3 w-3" />
                <span className="text-xs">Support</span>
              </Badge>
            )}
            {conversation.active_agent === 'sales' && (
              <Badge variant="outline" className="gap-1 bg-blue-50 text-blue-700 border-blue-200">
                <TrendingUp className="h-3 w-3" />
                <span className="text-xs">Sales</span>
              </Badge>
            )}
            {conversation.active_agent === 'boss' && (
              <Badge variant="outline" className="gap-1 bg-purple-50 text-purple-700 border-purple-200">
                <UserCircle className="h-3 w-3" />
                <span className="text-xs">Boss</span>
              </Badge>
            )}
            {conversation.human_takeover ? (
              <Badge variant="secondary" className="gap-1">
                <UserCog className="h-3 w-3" />
                <span className="text-xs">Human</span>
              </Badge>
            ) : !conversation.active_agent && (
              <Badge variant="outline" className="gap-1">
                <Bot className="h-3 w-3" />
                <span className="text-xs">AI</span>
              </Badge>
            )}
            
            {conversation.unread_count > 0 && (
              <Badge variant="default" className="h-5 min-w-5 px-1.5 rounded-full">
                {conversation.unread_count}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Unread indicator dot */}
      {conversation.unread_count > 0 && (
        <div className="absolute left-2 top-1/2 -translate-y-1/2 h-2 w-2 bg-primary rounded-full" />
      )}
    </div>
  );
};
