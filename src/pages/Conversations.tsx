import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Search, Send, UserCog, Bot, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import BackButton from '@/components/BackButton';
import ThemeToggle from '@/components/ThemeToggle';

const Conversations = () => {
  const { toast } = useToast();
  const [conversations, setConversations] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState({ total: 0, active: 0, avgDuration: 0 });
  const [messageInputs, setMessageInputs] = useState<Record<string, string>>({});
  const [sendingMessage, setSendingMessage] = useState<string | null>(null);
  const [generatingImage, setGeneratingImage] = useState<string | null>(null);

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

  const filteredConversations = conversations.filter((conv: any) =>
    conv.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
    conv.phone?.includes(search)
  ).sort((a: any, b: any) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

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

  const generateAndSendImage = async (conversationId: string) => {
    const prompt = messageInputs[conversationId]?.trim();
    if (!prompt) {
      toast({
        title: 'Prompt required',
        description: 'Please enter a description for the image you want to generate',
        variant: 'destructive'
      });
      return;
    }

    setGeneratingImage(conversationId);

    try {
      const { data, error } = await supabase.functions.invoke('generate-business-image', {
        body: { prompt, conversationId }
      });

      if (error) throw error;

      if (data?.image_url) {
        // Send the image as a message
        const imageMessage = `Here's the image you requested:\n${data.image_url}`;
        
        const { error: sendError } = await supabase.functions.invoke('send-whatsapp-message', {
          body: { conversationId, message: imageMessage }
        });

        if (sendError) throw sendError;

        setMessageInputs(prev => ({ ...prev, [conversationId]: '' }));
        toast({
          title: 'Image generated and sent',
          description: 'The AI-generated image has been sent to the customer'
        });
        fetchConversations();
      }
    } catch (error: any) {
      console.error('Error generating image:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to generate image. Make sure image generation is enabled in Settings.',
        variant: 'destructive'
      });
    } finally {
      setGeneratingImage(null);
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

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {filteredConversations.length === 0 ? (
        <Card className="card-glass">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground">No conversations found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {filteredConversations.map((conversation: any) => (
            <Card key={conversation.id} className="card-glass flex flex-col h-[700px]">
              {/* Header */}
              <CardHeader className="border-b pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-sm font-semibold text-primary">
                        {conversation.customer_name?.[0]?.toUpperCase() || '?'}
                      </span>
                    </div>
                    <div>
                      <h3 className="font-semibold text-base">
                        {conversation.customer_name || 'Unknown Customer'}
                      </h3>
                      <p className="text-xs text-muted-foreground">{conversation.phone}</p>
                    </div>
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
                        AI Mode
                      </>
                    ) : (
                      <>
                        <UserCog className="w-4 h-4" />
                        Take Over
                      </>
                    )}
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  Started {new Date(conversation.started_at).toLocaleString()}
                </div>
              </CardHeader>
              
              {/* Messages Area */}
              <CardContent className="flex-1 overflow-y-auto p-4 space-y-3">
                {conversation.messages.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                    No messages yet
                  </div>
                ) : (
                  conversation.messages.map((message: any) => {
                    const isInbound = message.role === 'user';
                    return (
                      <div
                        key={message.id}
                        className={`flex ${isInbound ? 'justify-start' : 'justify-end'}`}
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
                  })
                )}
              </CardContent>

              {/* Input Area - Always visible when takeover is active */}
              {conversation.human_takeover && (
                <div className="border-t bg-background/50 p-4 space-y-2">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Type your message or describe an image to generate..."
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
                      disabled={sendingMessage === conversation.id || generatingImage === conversation.id}
                      className="flex-1"
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => generateAndSendImage(conversation.id)}
                      disabled={!messageInputs[conversation.id]?.trim() || generatingImage === conversation.id || sendingMessage === conversation.id}
                      title="Generate and send AI image"
                    >
                      {generatingImage === conversation.id ? (
                        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Sparkles className="w-4 h-4" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      onClick={() => sendMessage(conversation.id)}
                      disabled={!messageInputs[conversation.id]?.trim() || sendingMessage === conversation.id || generatingImage === conversation.id}
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground px-1">
                    Type a message or describe an image (e.g., "Show me a modern bob haircut") and click <Sparkles className="w-3 h-3 inline" /> to generate
                  </p>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default Conversations;