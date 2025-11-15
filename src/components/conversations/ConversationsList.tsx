import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Filter } from 'lucide-react';
import { ConversationItem } from './ConversationItem';
import { ScrollArea } from '@/components/ui/scroll-area';

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
}

interface ConversationsListProps {
  conversations: Conversation[];
  selectedConversationId: string | null;
  onSelectConversation: (id: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  filter: 'all' | 'unread' | 'takeover';
  onFilterChange: (filter: 'all' | 'unread' | 'takeover') => void;
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
      filter === 'takeover' ? conv.human_takeover : true;
    
    return matchesSearch && matchesFilter;
  });

  const unreadCount = conversations.filter(c => c.unread_count > 0).length;
  const takeoverCount = conversations.filter(c => c.human_takeover).length;

  return (
    <div className="flex flex-col h-full bg-card border-r border-border">
      {/* Search Bar */}
      <div className="p-4 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Filter Buttons */}
      <div className="flex gap-2 p-4 border-b border-border">
        <Button
          variant={filter === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => onFilterChange('all')}
          className="flex-1"
        >
          All
        </Button>
        <Button
          variant={filter === 'unread' ? 'default' : 'outline'}
          size="sm"
          onClick={() => onFilterChange('unread')}
          className="flex-1"
        >
          Unread {unreadCount > 0 && `(${unreadCount})`}
        </Button>
        <Button
          variant={filter === 'takeover' ? 'default' : 'outline'}
          size="sm"
          onClick={() => onFilterChange('takeover')}
          className="flex-1"
        >
          Takeover {takeoverCount > 0 && `(${takeoverCount})`}
        </Button>
      </div>

      {/* Conversations List */}
      <ScrollArea className="flex-1">
        <div className="divide-y divide-border">
          {filteredConversations.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <p>No conversations found</p>
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
