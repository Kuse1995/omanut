import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCompany } from '@/context/CompanyContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { 
  Search, Send, MessageCircle, Bot, UserCog, 
  Headset, TrendingUp, UserCircle, Loader2, ChevronDown, Facebook, MessageSquare
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { ChatBubble } from '@/components/conversations/ChatBubble';
import { DateDivider } from '@/components/conversations/DateDivider';
import { useToast } from '@/hooks/use-toast';

interface Message {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
  message_metadata?: any;
}

interface Conversation {
  id: string;
  customer_name: string | null;
  phone: string | null;
  started_at: string;
  human_takeover: boolean;
  active_agent: string | null;
  unread_count: number;
  messages: Message[];
}

export const ConversationsPanel = () => {
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'takeover' | 'facebook' | 'messenger'>('all');
  const [messageInput, setMessageInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const lastConversationIdRef = useRef<string | null>(null);
  const isNearBottomRef = useRef(true);

  useEffect(() => {
    if (!selectedCompany?.id) return;

    fetchConversations();
    
    const channel = supabase
      .channel('admin-messages-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => fetchConversations())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => fetchConversations())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedCompany?.id]);

  // Auto-scroll when switching conversations or new messages arrive
  useEffect(() => {
    if (!selectedConversationId) return;
    
    // Always scroll to bottom when switching to a different conversation
    if (lastConversationIdRef.current !== selectedConversationId) {
      lastConversationIdRef.current = selectedConversationId;
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      }, 0);
    } else if (isNearBottomRef.current) {
      // Only auto-scroll for new messages if already near bottom
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [selectedConversationId, conversations]);

  // Handle scroll to detect if user is near bottom
  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const scrollTop = target.scrollTop;
    const scrollHeight = target.scrollHeight;
    const clientHeight = target.clientHeight;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    
    isNearBottomRef.current = distanceFromBottom < 100;
    setShowScrollButton(distanceFromBottom > 200);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchConversations = async () => {
    if (!selectedCompany?.id) return;

    setLoading(true);
    
    const { data: convData, error: convError } = await supabase
      .from('conversations')
      .select('id, customer_name, phone, started_at, human_takeover, active_agent, unread_count')
      .eq('company_id', selectedCompany.id)
      .order('started_at', { ascending: false })
      .limit(50);

    if (convError) {
      console.error('Error fetching conversations:', convError);
      setLoading(false);
      return;
    }

    if (!convData || convData.length === 0) {
      setConversations([]);
      setLoading(false);
      return;
    }

    const conversationIds = convData.map(c => c.id);
    
    const { data: msgData, error: msgError } = await supabase
      .from('messages')
      .select('*')
      .in('conversation_id', conversationIds)
      .order('created_at', { ascending: true });

    if (msgError) {
      console.error('Error fetching messages:', msgError);
      setLoading(false);
      return;
    }

    const conversationsWithMessages = convData.map(conv => ({
      ...conv,
      messages: msgData?.filter(msg => msg.conversation_id === conv.id) || []
    }));

    setConversations(conversationsWithMessages);
    
    // Auto-select first conversation if none selected
    if (!selectedConversationId && conversationsWithMessages.length > 0) {
      setSelectedConversationId(conversationsWithMessages[0].id);
    }
    
    setLoading(false);
  };

  const selectedConversation = conversations.find(c => c.id === selectedConversationId);

  const filteredConversations = conversations.filter(conv => {
    const matchesSearch = 
      conv.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
      conv.phone?.includes(search);
    
    const matchesFilter = 
      filter === 'all' ? true :
      filter === 'unread' ? (conv.unread_count > 0) :
      filter === 'takeover' ? conv.human_takeover :
      filter === 'facebook' ? (conv.phone?.startsWith('fb:') && !conv.phone?.startsWith('fbdm:')) :
      filter === 'messenger' ? (conv.phone?.startsWith('fbdm:')) : true;
    
    return matchesSearch && matchesFilter;
  });

  const sendMessage = async () => {
    if (!selectedConversation || !messageInput.trim()) return;

    setSending(true);

    try {
      const { error } = await supabase.functions.invoke('send-whatsapp-message', {
        body: {
          phone: selectedConversation.phone,
          message: messageInput.trim(),
          conversationId: selectedConversation.id
        }
      });

      if (error) throw error;

      setMessageInput('');
      toast({ title: "Message sent" });
      fetchConversations();
    } catch (error: any) {
      console.error('Error sending message:', error);
      toast({ title: "Error", description: error.message || "Failed to send message", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const getInitials = (conv: Conversation) => {
    if (conv.customer_name) {
      return conv.customer_name.substring(0, 2).toUpperCase();
    }
    return conv.phone?.substring(0, 2) || '??';
  };

  const getAgentBadge = (conv: Conversation) => {
    if (conv.human_takeover) {
      return <Badge variant="secondary" className="h-5 text-[10px] gap-1"><UserCog className="h-3 w-3" />Human</Badge>;
    }
    switch (conv.active_agent) {
      case 'support':
        return <Badge className="h-5 text-[10px] gap-1 bg-blue-500/10 text-blue-400 border-blue-500/20"><Headset className="h-3 w-3" />Support</Badge>;
      case 'sales':
        return <Badge className="h-5 text-[10px] gap-1 bg-emerald-500/10 text-emerald-400 border-emerald-500/20"><TrendingUp className="h-3 w-3" />Sales</Badge>;
      case 'boss':
        return <Badge className="h-5 text-[10px] gap-1 bg-amber-500/10 text-amber-400 border-amber-500/20"><UserCircle className="h-3 w-3" />Boss</Badge>;
      default:
        return <Badge variant="outline" className="h-5 text-[10px] gap-1"><Bot className="h-3 w-3" />AI</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <MessageCircle className="h-16 w-16 mb-4 opacity-30" />
        <p>No conversations yet</p>
      </div>
    );
  }

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      {/* Left Panel - Conversation List */}
      <ResizablePanel defaultSize={35} minSize={25} maxSize={45}>
        <div className="flex flex-col h-full min-h-0 border-r border-border">
          {/* Search */}
          <div className="p-4 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-secondary/50 border-0"
              />
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-1 p-2 border-b border-border bg-secondary/30">
            {(['all', 'unread', 'takeover'] as const).map((f) => (
              <Button
                key={f}
                variant="ghost"
                size="sm"
                onClick={() => setFilter(f)}
                className={cn(
                  "flex-1 h-7 text-xs capitalize",
                  filter === f && "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
              >
                {f === 'takeover' ? 'Human' : f}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFilter('facebook')}
              className={cn(
                "flex-1 h-7 text-xs gap-1",
                filter === 'facebook' && "bg-blue-600 text-white hover:bg-blue-700"
              )}
            >
              <Facebook className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFilter('messenger')}
              className={cn(
                "flex-1 h-7 text-xs gap-1",
                filter === 'messenger' && "bg-violet-600 text-white hover:bg-violet-700"
              )}
            >
              <MessageSquare className="h-3 w-3" />
            </Button>
          </div>

          {/* List */}
          <ScrollArea className="flex-1">
            <div className="divide-y divide-border/50">
              {filteredConversations.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => setSelectedConversationId(conv.id)}
                  className={cn(
                    "p-3 cursor-pointer transition-all hover:bg-accent/50",
                    selectedConversationId === conv.id && "bg-accent border-l-2 border-l-primary"
                  )}
                >
                    <div className="flex gap-3">
                    <div className="relative shrink-0">
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className={cn(
                          "text-sm font-semibold",
                          selectedConversationId === conv.id 
                            ? "bg-primary text-primary-foreground" 
                            : "bg-primary/10 text-primary"
                        )}>
                          {getInitials(conv)}
                        </AvatarFallback>
                      </Avatar>
                      {conv.phone?.startsWith('fbdm:') ? (
                        <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 bg-violet-600 rounded-full border-2 border-card flex items-center justify-center">
                          <MessageSquare className="h-2.5 w-2.5 text-white" />
                        </div>
                      ) : conv.phone?.startsWith('fb:') ? (
                        <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 bg-blue-600 rounded-full border-2 border-card flex items-center justify-center">
                          <Facebook className="h-2.5 w-2.5 text-white" />
                        </div>
                      ) : (
                        <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 bg-emerald-500 rounded-full border-2 border-card flex items-center justify-center">
                          <MessageCircle className="h-2.5 w-2.5 text-white" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-0.5">
                        <span className="font-medium text-sm truncate">
                          {conv.customer_name || conv.phone || 'Unknown'}
                        </span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {formatDistanceToNow(new Date(conv.started_at), { addSuffix: false })}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mb-1">
                        {conv.messages[conv.messages.length - 1]?.content?.substring(0, 40) || 'No messages'}...
                      </p>
                      <div className="flex items-center justify-between">
                        {getAgentBadge(conv)}
                        {conv.unread_count > 0 && (
                          <Badge className="h-5 min-w-5 px-1.5 rounded-full text-[10px]">
                            {conv.unread_count}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* Right Panel - Chat View */}
      <ResizablePanel defaultSize={65}>
        {selectedConversation ? (
          <div className="flex flex-col h-full min-h-0 relative">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border bg-card/50">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="bg-primary text-primary-foreground font-semibold">
                    {getInitials(selectedConversation)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="font-semibold text-sm">
                    {selectedConversation.customer_name || selectedConversation.phone}
                  </h3>
                  <p className="text-xs text-muted-foreground">{selectedConversation.phone}</p>
                </div>
              </div>
              {getAgentBadge(selectedConversation)}
            </div>

            {/* Messages */}
            <div 
              className="flex-1 min-h-0 overflow-y-auto p-4"
              ref={scrollAreaRef}
              onScroll={handleScroll}
            >
              <div className="space-y-0 max-w-3xl mx-auto">
                {selectedConversation.messages.map((message, idx) => {
                  const showDateDivider = idx === 0 || 
                    format(new Date(message.created_at), 'yyyy-MM-dd') !== 
                    format(new Date(selectedConversation.messages[idx - 1].created_at), 'yyyy-MM-dd');

                  // Message grouping logic
                  const prevMsg = idx > 0 ? selectedConversation.messages[idx - 1] : null;
                  const nextMsg = idx < selectedConversation.messages.length - 1 ? selectedConversation.messages[idx + 1] : null;
                  
                  const timeDiffFromPrev = prevMsg 
                    ? (new Date(message.created_at).getTime() - new Date(prevMsg.created_at).getTime()) / 1000 / 60 
                    : Infinity;
                  const timeDiffToNext = nextMsg 
                    ? (new Date(nextMsg.created_at).getTime() - new Date(message.created_at).getTime()) / 1000 / 60 
                    : Infinity;
                  
                  const isFirstInGroup = showDateDivider || !prevMsg || prevMsg.role !== message.role || timeDiffFromPrev > 2;
                  const isLastInGroup = !nextMsg || nextMsg.role !== message.role || timeDiffToNext > 2 || 
                    (nextMsg && format(new Date(nextMsg.created_at), 'yyyy-MM-dd') !== format(new Date(message.created_at), 'yyyy-MM-dd'));

                  return (
                    <div key={message.id}>
                      {showDateDivider && <DateDivider date={message.created_at} />}
                      <ChatBubble
                        content={message.content}
                        role={message.role as 'user' | 'assistant'}
                        timestamp={message.created_at}
                        metadata={message.message_metadata}
                        isFirstInGroup={isFirstInGroup}
                        isLastInGroup={isLastInGroup}
                        showTimestamp={true}
                      />
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Scroll to bottom button */}
            {showScrollButton && (
              <Button
                size="icon"
                variant="secondary"
                className="absolute bottom-24 right-6 h-10 w-10 rounded-full shadow-lg z-10"
                onClick={scrollToBottom}
              >
                <ChevronDown className="h-5 w-5" />
              </Button>
            )}

            {/* Input */}
            <div className="p-4 border-t border-border bg-card/50">
              <div className="flex gap-2">
                <Input
                  placeholder="Type a message..."
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                  className="flex-1"
                  disabled={sending}
                />
                <Button onClick={sendMessage} disabled={sending || !messageInput.trim()}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <MessageCircle className="h-16 w-16 mb-4 opacity-30" />
            <p>Select a conversation to view messages</p>
          </div>
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};
