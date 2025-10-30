import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCompany } from '@/context/CompanyContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface Message {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
}

interface Conversation {
  id: string;
  customer_name: string | null;
  phone: string | null;
  started_at: string;
  messages: Message[];
}

interface GroupedConversation {
  phone: string;
  customer_name: string | null;
  conversations: Conversation[];
  totalMessages: number;
  lastMessageAt: string;
}

export const ConversationsPanel = () => {
  const { selectedCompany } = useCompany();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedPhones, setExpandedPhones] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!selectedCompany?.id) return;

    fetchConversations();
    
    const channel = supabase
      .channel('messages-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
        },
        () => {
          fetchConversations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedCompany?.id]);

  const fetchConversations = async () => {
    if (!selectedCompany?.id) return;

    setLoading(true);
    
    const { data: convData, error: convError } = await supabase
      .from('conversations')
      .select('id, customer_name, phone, started_at')
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
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-white/60">Loading conversations...</p>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-white/60">No conversations yet</p>
      </div>
    );
  }

  // Group conversations by phone number
  const groupedConversations: GroupedConversation[] = Object.values(
    conversations.reduce((acc, conv) => {
      const phone = conv.phone || 'Unknown';
      if (!acc[phone]) {
        acc[phone] = {
          phone,
          customer_name: conv.customer_name,
          conversations: [],
          totalMessages: 0,
          lastMessageAt: conv.started_at
        };
      }
      acc[phone].conversations.push(conv);
      acc[phone].totalMessages += conv.messages.length;
      if (new Date(conv.started_at) > new Date(acc[phone].lastMessageAt)) {
        acc[phone].lastMessageAt = conv.started_at;
      }
      if (conv.customer_name) {
        acc[phone].customer_name = conv.customer_name;
      }
      return acc;
    }, {} as Record<string, GroupedConversation>)
  ).sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

  const togglePhone = (phone: string) => {
    setExpandedPhones(prev => {
      const next = new Set(prev);
      if (next.has(phone)) {
        next.delete(phone);
      } else {
        next.add(phone);
      }
      return next;
    });
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-4">
        {groupedConversations.map((group) => (
          <Collapsible
            key={group.phone}
            open={expandedPhones.has(group.phone)}
            onOpenChange={() => togglePhone(group.phone)}
          >
            <div className="border border-white/10 rounded-lg overflow-hidden bg-[#1A1A1A]">
              <CollapsibleTrigger className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-3">
                  {expandedPhones.has(group.phone) ? (
                    <ChevronDown className="w-5 h-5 text-[#84CC16]" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-white/40" />
                  )}
                  <div className="text-left">
                    <h3 className="text-white font-semibold">
                      {group.customer_name || 'Unknown'}
                    </h3>
                    <p className="text-sm text-white/60">{group.phone}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs px-2 py-1 bg-[#84CC16]/10 border border-[#84CC16]/20 rounded text-[#84CC16]">
                    {group.totalMessages} messages
                  </span>
                  <span className="text-xs text-white/40">
                    {format(new Date(group.lastMessageAt), 'MMM d, HH:mm')}
                  </span>
                </div>
              </CollapsibleTrigger>
              
              <CollapsibleContent>
                <div className="border-t border-white/10">
                  {group.conversations.map((conversation) => (
                    <div key={conversation.id} className="p-4 space-y-3 border-b border-white/10 last:border-b-0 bg-[#0D1117]">
                      <div className="text-xs text-center text-white/30 mb-3">
                        {format(new Date(conversation.started_at), 'MMMM d, yyyy • HH:mm')}
                      </div>
                      {conversation.messages.map((message, idx) => {
                        const isInbound = message.role === 'user';
                        return (
                          <div
                            key={message.id}
                            className={`flex ${isInbound ? 'justify-start' : 'justify-end'} mb-2`}
                          >
                            <div
                              className={`max-w-[75%] rounded-lg px-3 py-2 ${
                                isInbound 
                                  ? 'bg-[#2A2A2A] text-white rounded-tl-none' 
                                  : 'bg-[#005C4B] text-white rounded-tr-none'
                              }`}
                            >
                              <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
                              <div className="flex items-center justify-end gap-1 mt-1">
                                <span className="text-[10px] text-white/50">
                                  {format(new Date(message.created_at), 'HH:mm')}
                                </span>
                                {!isInbound && (
                                  <svg className="w-4 h-4 text-blue-400" viewBox="0 0 16 15" fill="none">
                                    <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.879a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.064-.512zm-4.1 0l-.478-.372a.365.365 0 0 0-.51.063L4.566 9.879a.32.32 0 0 1-.484.033L1.891 7.769a.366.366 0 0 0-.515.006l-.423.433a.364.364 0 0 0 .006.514l3.258 3.185c.143.14.361.125.484-.033l6.272-8.048a.365.365 0 0 0-.063-.51z" fill="currentColor"/>
                                  </svg>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        ))}
      </div>
    </ScrollArea>
  );
};
