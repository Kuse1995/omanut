import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, MessageCircle, Facebook, MessageSquare } from 'lucide-react';
import { ConversationItem } from './ConversationItem';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface Conversation {
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
}

interface ConversationsListProps {
  conversations: Conversation[];
  selectedConversationId: string | null;
  onSelectConversation: (id: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  filter: 'all' | 'unread' | 'takeover' | 'facebook' | 'messenger' | 'whatsapp';
  onFilterChange: (filter: 'all' | 'unread' | 'takeover' | 'facebook' | 'messenger' | 'whatsapp') => void;
}

export const ConversationsList = ({
  conversations,
  selectedConversationId,
  onSelectConversation,
  search,
  onSearchChange,
  filter,
  onFilterChange
}: ConversationsListProps) => {
  const filteredConversations = conversations.filter(conv => {
    const matchesSearch = 
      conv.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
      conv.phone?.includes(search);
    
    const matchesFilter = 
      filter === 'all' ? true :
      filter === 'unread' ? (conv.unread_count > 0) :
      filter === 'takeover' ? conv.human_takeover :
      filter === 'facebook' ? (conv.phone?.startsWith('fb:') && !conv.phone?.startsWith('fbdm:')) :
      filter === 'messenger' ? (conv.phone?.startsWith('fbdm:')) :
      filter === 'whatsapp' ? (!conv.phone?.startsWith('fb:') && !conv.phone?.startsWith('fbdm:')) : true;
    
    return matchesSearch && matchesFilter;
  });

  const unreadCount = conversations.filter(c => c.unread_count > 0).length;
  const takeoverCount = conversations.filter(c => c.human_takeover).length;
  const facebookCount = conversations.filter(c => c.phone?.startsWith('fb:') && !c.phone?.startsWith('fbdm:')).length;
  const messengerCount = conversations.filter(c => c.phone?.startsWith('fbdm:')).length;

  return (
    <div className="flex flex-col h-full bg-card border-r border-border">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <h2 className="text-lg font-semibold mb-3">Messages</h2>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 bg-secondary/50 border-0 focus-visible:ring-1"
          />
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 p-2 border-b border-border bg-secondary/30">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onFilterChange('all')}
          className={cn(
            "flex-1 h-8 text-xs font-medium",
            filter === 'all' && "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
        >
          All
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onFilterChange('unread')}
          className={cn(
            "flex-1 h-8 text-xs font-medium gap-1",
            filter === 'unread' && "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
        >
          Unread
          {unreadCount > 0 && (
            <span className={cn(
              "text-[10px] px-1.5 rounded-full",
              filter === 'unread' 
                ? "bg-primary-foreground/20" 
                : "bg-primary/10 text-primary"
            )}>
              {unreadCount}
            </span>
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onFilterChange('takeover')}
          className={cn(
            "flex-1 h-8 text-xs font-medium gap-1",
            filter === 'takeover' && "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
        >
          Human
          {takeoverCount > 0 && (
            <span className={cn(
              "text-[10px] px-1.5 rounded-full",
              filter === 'takeover' 
                ? "bg-primary-foreground/20" 
                : "bg-primary/10 text-primary"
            )}>
              {takeoverCount}
            </span>
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onFilterChange('facebook')}
          className={cn(
            "flex-1 h-8 text-xs font-medium gap-1",
            filter === 'facebook' && "bg-blue-600 text-white hover:bg-blue-700"
          )}
        >
          <Facebook className="h-3 w-3" />
          {facebookCount > 0 && (
            <span className={cn(
              "text-[10px] px-1.5 rounded-full",
              filter === 'facebook' 
                ? "bg-white/20" 
                : "bg-blue-500/10 text-blue-600"
            )}>
              {facebookCount}
            </span>
          )}
        </Button>
      </div>

      {/* Conversations List */}
      <ScrollArea className="flex-1">
        <div className="divide-y divide-border/50">
          {filteredConversations.length === 0 ? (
            <div className="p-8 text-center">
              <MessageCircle className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No conversations found</p>
            </div>
          ) : (
            filteredConversations.map((conversation) => (
              <ConversationItem
                key={conversation.id}
                conversation={conversation}
                isSelected={conversation.id === selectedConversationId}
                onClick={() => onSelectConversation(conversation.id)}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
