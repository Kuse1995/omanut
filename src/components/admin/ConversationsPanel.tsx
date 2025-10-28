import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCompany } from '@/context/CompanyContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';

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

export const ConversationsPanel = () => {
  const { selectedCompany } = useCompany();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

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
      .limit(20);

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

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {conversations.map((conversation) => (
          <div key={conversation.id} className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-white font-semibold">
                  {conversation.customer_name || 'Unknown'}
                </h3>
                <p className="text-sm text-white/60">{conversation.phone || 'No phone'}</p>
              </div>
              <span className="text-xs text-white/40">
                {format(new Date(conversation.started_at), 'MMM d, HH:mm')}
              </span>
            </div>
            
            <div className="space-y-2">
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
            
            <div className="border-t border-white/10 pt-4" />
          </div>
        ))}
      </div>
    </ScrollArea>
  );
};
