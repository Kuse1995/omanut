import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Search, Send, UserCog, Bot } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import BackButton from '@/components/BackButton';
import ThemeToggle from '@/components/ThemeToggle';

const Conversations = () => {
  const { toast } = useToast();
  const [conversations, setConversations] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState({ total: 0, active: 0, avgDuration: 0 });
  const [expandedPhones, setExpandedPhones] = useState<Set<string>>(new Set());
  const [messageInputs, setMessageInputs] = useState<Record<string, string>>({});
  const [sendingMessage, setSendingMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchConversations();

    // Subscribe to realtime updates for both conversations and messages
    const channel = supabase
      .channel('conversations-messages-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations'
        },
        () => fetchConversations()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages'
        },
        () => fetchConversations()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchConversations = async () => {
    // Get current user's company
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data: userData } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', session.user.id)
      .single();

    if (!userData?.company_id) return;

    const { data: convData, error: convError } = await supabase
      .from('conversations')
      .select('id, customer_name, phone, started_at, status, duration_seconds, human_takeover')
      .eq('company_id', userData.company_id)
      .order('started_at', { ascending: false })
      .limit(50);

    if (convError) {
      console.error('Error fetching conversations:', convError);
      return;
    }

    if (!convData || convData.length === 0) {
      setConversations([]);
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
      return;
    }

    const conversationsWithMessages = convData.map(conv => ({
      ...conv,
      messages: msgData?.filter(msg => msg.conversation_id === conv.id) || []
    }));

    setConversations(conversationsWithMessages);

    // Calculate stats
    const total = convData?.length || 0;
    const active = convData?.filter(c => c.status === 'active').length || 0;
    const completed = convData?.filter(c => c.duration_seconds) || [];
    const avgDuration = completed.length > 0
      ? Math.round(completed.reduce((sum, c) => sum + (c.duration_seconds || 0), 0) / completed.length)
      : 0;

    setStats({ total, active, avgDuration });
  };

  // Group conversations by phone number
  const groupedConversations = Object.values(
    conversations.reduce((acc: Record<string, any>, conv) => {
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
    }, {})
  ).sort((a: any, b: any) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

  const filteredConversations = groupedConversations.filter((group: any) =>
    group.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
    group.phone?.includes(search)
  );

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

  const handleTakeover = async (conversationId: string, currentState: boolean) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { error } = await supabase
      .from('conversations')
      .update({
        human_takeover: !currentState,
        takeover_by: !currentState ? session.user.id : null,
        takeover_at: !currentState ? new Date().toISOString() : null
      })
      .eq('id', conversationId);

    if (error) {
      toast({
        title: 'Error',
        description: 'Failed to toggle takeover mode',
        variant: 'destructive'
      });
    } else {
      toast({
        title: currentState ? 'AI Mode Enabled' : 'Human Takeover Enabled',
        description: currentState 
          ? 'AI will now respond to messages' 
          : 'You can now respond directly to the customer'
      });
      fetchConversations();
    }
  };

  const sendMessage = async (conversationId: string) => {
    const message = messageInputs[conversationId]?.trim();
    if (!message) return;

    setSendingMessage(conversationId);

    try {
      const { error } = await supabase.functions.invoke('send-whatsapp-message', {
        body: { conversationId, message }
      });

      if (error) throw error;

      setMessageInputs(prev => ({ ...prev, [conversationId]: '' }));
      toast({
        title: 'Message sent',
        description: 'Your message has been sent to the customer'
      });
      fetchConversations();
    } catch (error) {
      console.error('Error sending message:', error);
      toast({
        title: 'Error',
        description: 'Failed to send message',
        variant: 'destructive'
      });
    } finally {
      setSendingMessage(null);
    }
  };

  return (
    <div className="p-8 space-y-8 bg-app min-h-screen animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <BackButton />
        <ThemeToggle />
      </div>
      <div>
        <h1 className="text-4xl font-bold mb-2">
          <span className="text-gradient">Conversations</span>
        </h1>
        <p className="text-lg text-muted-foreground">All customer interactions</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Calls</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Now</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{stats.active}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Duration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.avgDuration}s</div>
          </CardContent>
        </Card>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
        <Input
          placeholder="Search by name or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 mb-4"
        />
      </div>

      <div className="space-y-4">
        {filteredConversations.length === 0 ? (
          <Card>
            <CardContent className="flex items-center justify-center h-64">
              <p className="text-muted-foreground">No conversations yet</p>
            </CardContent>
          </Card>
        ) : (
          filteredConversations.map((group: any) => (
            <Card key={group.phone} className="overflow-hidden">
              <button
                onClick={() => togglePhone(group.phone)}
                className="w-full p-4 flex items-center justify-between hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className={`transition-transform ${expandedPhones.has(group.phone) ? 'rotate-90' : ''}`}>
                    <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <h3 className="font-semibold text-foreground">
                      {group.customer_name || 'Unknown'}
                    </h3>
                    <p className="text-sm text-muted-foreground">{group.phone}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <Badge variant="outline">
                    {group.totalMessages} messages
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(group.lastMessageAt).toLocaleDateString()}
                  </span>
                </div>
              </button>
              
              {expandedPhones.has(group.phone) && (
                <div className="border-t">
                  {group.conversations.map((conversation: any) => (
                    <div key={conversation.id} className="p-4 space-y-3 border-b last:border-b-0 bg-muted/20">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-xs text-muted-foreground">
                          {new Date(conversation.started_at).toLocaleString()}
                        </div>
                        <Button
                          size="sm"
                          variant={conversation.human_takeover ? "default" : "outline"}
                          onClick={() => handleTakeover(conversation.id, conversation.human_takeover)}
                          className="gap-2"
                        >
                          {conversation.human_takeover ? (
                            <>
                              <Bot className="w-4 h-4" />
                              Return to AI
                            </>
                          ) : (
                            <>
                              <UserCog className="w-4 h-4" />
                              Take Over
                            </>
                          )}
                        </Button>
                      </div>
                      
                      {conversation.messages.map((message: any) => {
                        const isInbound = message.role === 'user';
                        return (
                          <div
                            key={message.id}
                            className={`flex ${isInbound ? 'justify-start' : 'justify-end'} mb-2`}
                          >
                            <div
                              className={`max-w-[75%] rounded-lg px-3 py-2 ${
                                isInbound 
                                  ? 'bg-muted text-foreground rounded-tl-none' 
                                  : 'bg-primary text-primary-foreground rounded-tr-none'
                              }`}
                            >
                              <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
                              <div className="flex items-center justify-end gap-1 mt-1">
                                <span className="text-[10px] opacity-70">
                                  {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      {conversation.human_takeover && (
                        <div className="flex gap-2 pt-2">
                          <Input
                            placeholder="Type your message..."
                            value={messageInputs[conversation.id] || ''}
                            onChange={(e) => setMessageInputs(prev => ({
                              ...prev,
                              [conversation.id]: e.target.value
                            }))}
                            onKeyPress={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                sendMessage(conversation.id);
                              }
                            }}
                            disabled={sendingMessage === conversation.id}
                          />
                          <Button
                            size="icon"
                            onClick={() => sendMessage(conversation.id)}
                            disabled={!messageInputs[conversation.id]?.trim() || sendingMessage === conversation.id}
                          >
                            <Send className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  );
};

export default Conversations;