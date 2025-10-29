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
                    <div key={conversation.id} className="p-4 space-y-2 border-b border-white/10 last:border-b-0">
                      <div className="text-xs text-white/40 mb-2">
                        Session: {format(new Date(conversation.started_at), 'MMM d, HH:mm')}
                      </div>
                      {conversation.messages.map((message) => {
                        const isInbound = message.role === 'user';
                        return (
                          <div
                            key={message.id}
                            className={`p-3 rounded-lg ${
                              isInbound 
                                ? 'bg-[#2A2A2A] text-white' 
                                : 'bg-[#84CC16]/10 border border-[#84CC16]/20 text-white'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <span className="text-xs font-medium text-white/60">
                                {isInbound ? 'Customer' : 'AI Assistant'}
                              </span>
                              <span className="text-xs text-white/40">
                                {format(new Date(message.created_at), 'HH:mm')}
                              </span>
                            </div>
                            <p className="text-sm">{message.content}</p>
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
