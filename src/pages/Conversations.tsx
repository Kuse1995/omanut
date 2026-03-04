import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import BackButton from '@/components/BackButton';
import ThemeToggle from '@/components/ThemeToggle';
import { MediaViewer } from '@/components/MediaViewer';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { ConversationsList } from '@/components/conversations/ConversationsList';
import { ChatView } from '@/components/conversations/ChatView';
import SupervisorAnalysisPanel from '@/components/conversations/SupervisorAnalysisPanel';
import { Brain, Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const Conversations = () => {
  const { toast } = useToast();
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'takeover'>('all');
  const [messageInputs, setMessageInputs] = useState<Record<string, string>>({});
  const [sendingMessage, setSendingMessage] = useState<string | null>(null);
  const [generatingImage, setGeneratingImage] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<Record<string, File | null>>({});
  const [agentSwitches, setAgentSwitches] = useState<Record<string, any[]>>({});
  const [mediaViewer, setMediaViewer] = useState<{
    open: boolean;
    url: string;
    type: string;
    fileName?: string;
  }>({ open: false, url: '', type: '' });
  const [sendingFollowUps, setSendingFollowUps] = useState(false);
  const [followUpProgress, setFollowUpProgress] = useState<{ current: number; total: number } | null>(null);

  useEffect(() => {
    fetchConversations();

    const channel = supabase
      .channel('conversations-messages-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => fetchConversations())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => fetchConversations())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchConversations = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast({ title: "Authentication Required", description: "Please log in to view conversations.", variant: "destructive" });
      return;
    }

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', session.user.id)
      .single();

    if (userError || !userData?.company_id) {
      toast({ title: "Error", description: "Failed to load user data.", variant: "destructive" });
      return;
    }

    const { data: convData, error: convError } = await supabase
      .from('conversations')
      .select('id, customer_name, phone, started_at, status, human_takeover, unread_count, last_message_preview, pinned, archived, active_agent, platform')
      .eq('company_id', userData.company_id)
      .eq('archived', false)
      .order('pinned', { ascending: false })
      .order('started_at', { ascending: false })
      .limit(50);

    if (convError) {
      toast({ title: "Error", description: "Failed to load conversations.", variant: "destructive" });
      return;
    }

    const conversationsWithMessages = await Promise.all(
      (convData || []).map(async (conv) => {
        const { data: messages } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: true });
        
        // Fetch agent switches for this conversation
        const { data: switches } = await supabase
          .from('agent_performance')
          .select('id, agent_type, routed_at, notes')
          .eq('conversation_id', conv.id)
          .order('routed_at', { ascending: true });
        
        if (switches) {
          setAgentSwitches(prev => ({ ...prev, [conv.id]: switches }));
        }
        
        return { ...conv, messages: messages || [] };
      })
    );

    setConversations(conversationsWithMessages);

    // Auto-select first conversation if none selected
    if (!selectedConversationId && conversationsWithMessages.length > 0) {
      setSelectedConversationId(conversationsWithMessages[0].id);
    }
  };

  const selectedConversation = conversations.find(c => c.id === selectedConversationId);

  const handleTakeover = async () => {
    if (!selectedConversation) return;

    const newTakeoverState = !selectedConversation.human_takeover;
    
    const { error } = await supabase
      .from('conversations')
      .update({ 
        human_takeover: newTakeoverState,
        takeover_at: newTakeoverState ? new Date().toISOString() : null
      })
      .eq('id', selectedConversation.id);

    if (error) {
      toast({ title: "Error", description: "Failed to update takeover status.", variant: "destructive" });
    } else {
      toast({ 
        title: newTakeoverState ? "Takeover Activated" : "Released to AI",
        description: newTakeoverState ? "You can now respond to this customer." : "AI will handle this conversation."
      });
      fetchConversations();
    }
  };

  const sendMessage = async () => {
    if (!selectedConversation) return;
    
    const convId = selectedConversation.id;
    const messageText = messageInputs[convId]?.trim();
    const attachedFile = attachedFiles[convId];

    if (!messageText && !attachedFile) return;

    setSendingMessage(convId);

    try {
      let mediaUrl = null;
      let mediaType = null;
      let fileName = null;

      if (attachedFile) {
        const fileExt = attachedFile.name.split('.').pop();
        const filePath = `${selectedConversation.phone}/${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('conversation-media')
          .upload(filePath, attachedFile);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('conversation-media')
          .getPublicUrl(filePath);

        mediaUrl = publicUrl;
        mediaType = attachedFile.type;
        fileName = attachedFile.name;
      }

      const { error } = await supabase.functions.invoke('send-whatsapp-message', {
        body: {
          phone: selectedConversation.phone,
          message: messageText || '',
          conversationId: convId,
          mediaUrl,
          mediaType,
          fileName
        }
      });

      if (error) throw error;

      setMessageInputs(prev => ({ ...prev, [convId]: '' }));
      setAttachedFiles(prev => ({ ...prev, [convId]: null }));
      toast({ title: "Success", description: "Message sent successfully" });
      fetchConversations();
    } catch (error: any) {
      console.error('Error sending message:', error);
      toast({ title: "Error", description: error.message || "Failed to send message", variant: "destructive" });
    } finally {
      setSendingMessage(null);
    }
  };

  const generateAndSendImage = async () => {
    if (!selectedConversation) return;
    
    const convId = selectedConversation.id;
    const prompt = messageInputs[convId]?.trim();

    if (!prompt) {
      toast({ title: "Error", description: "Please enter a prompt for image generation", variant: "destructive" });
      return;
    }

    setGeneratingImage(convId);

    try {
      const { data, error } = await supabase.functions.invoke('generate-business-image', {
        body: { prompt, conversationId: convId }
      });

      if (error) throw error;

      setMessageInputs(prev => ({ ...prev, [convId]: '' }));
      toast({ title: "Success", description: "Image generated and sent!" });
      fetchConversations();
    } catch (error: any) {
      console.error('Error generating image:', error);
      toast({ title: "Error", description: error.message || "Failed to generate image", variant: "destructive" });
    } finally {
      setGeneratingImage(null);
    }
  };

  const triggerAutoFollowUp = async () => {
    // Get current user's company
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast({ title: "Authentication Required", description: "Please log in first.", variant: "destructive" });
      return;
    }

    const { data: userData } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', session.user.id)
      .single();

    if (!userData?.company_id) {
      toast({ title: "Error", description: "Company not found.", variant: "destructive" });
      return;
    }

    setSendingFollowUps(true);
    setFollowUpProgress(null);

    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-and-followup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          companyId: userData.company_id,
          hoursBack: 23, // 23 hours
          stream: true
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start follow-up process');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'start') {
                setFollowUpProgress({ current: 0, total: data.total });
                toast({ title: "Follow-up Started", description: `Processing ${data.total} conversations...` });
              } else if (data.type === 'progress') {
                setFollowUpProgress({ current: data.current, total: data.total });
              } else if (data.type === 'complete') {
                toast({ title: "Follow-ups Sent! 🎉", description: "AI-powered follow-up messages sent to all recent clients." });
              } else if (data.type === 'error') {
                toast({ title: "Error", description: data.message, variant: "destructive" });
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }

      fetchConversations();
    } catch (error: any) {
      console.error('Error triggering follow-ups:', error);
      toast({ title: "Error", description: error.message || "Failed to send follow-ups", variant: "destructive" });
    } finally {
      setSendingFollowUps(false);
      setFollowUpProgress(null);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-card">
        <div className="flex items-center gap-4">
          <BackButton />
          <h1 className="text-2xl font-bold">Conversations</h1>
        </div>
        <div className="flex items-center gap-3">
          <Button
            onClick={triggerAutoFollowUp}
            disabled={sendingFollowUps}
            variant="outline"
            className="gap-2"
          >
            {sendingFollowUps ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {followUpProgress 
                  ? `Sending ${followUpProgress.current}/${followUpProgress.total}...`
                  : 'Starting...'}
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Auto Follow-up (23h)
              </>
            )}
          </Button>
          <ThemeToggle />
        </div>
      </div>

      {/* Main Content - Split Pane */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          {/* Left Panel - Conversations List */}
          <ResizablePanel defaultSize={30} minSize={25} maxSize={40}>
            <ConversationsList
              conversations={conversations}
              selectedConversationId={selectedConversationId}
              onSelectConversation={setSelectedConversationId}
              search={search}
              onSearchChange={setSearch}
              filter={filter}
              onFilterChange={setFilter}
            />
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right Panel - Chat View */}
          <ResizablePanel defaultSize={50} minSize={40}>
            {selectedConversation ? (
              <ChatView
                conversation={selectedConversation}
                messageInput={messageInputs[selectedConversation.id] || ''}
                onMessageInputChange={(value) => 
                  setMessageInputs(prev => ({ ...prev, [selectedConversation.id]: value }))
                }
                onSendMessage={sendMessage}
                onGenerateImage={generateAndSendImage}
                onToggleTakeover={handleTakeover}
                attachedFile={attachedFiles[selectedConversation.id] || null}
                onAttachFile={(file) => 
                  setAttachedFiles(prev => ({ ...prev, [selectedConversation.id]: file }))
                }
                sendingMessage={sendingMessage === selectedConversation.id}
                generatingImage={generatingImage === selectedConversation.id}
                onMediaClick={(url, type, fileName) => 
                  setMediaViewer({ open: true, url, type, fileName })
                }
                agentSwitches={agentSwitches[selectedConversation.id] || []}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <p>Select a conversation to view messages</p>
              </div>
            )}
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Supervisor Analysis Panel */}
          <ResizablePanel defaultSize={20} minSize={15}>
            {selectedConversation ? (
              <SupervisorAnalysisPanel 
                conversationId={selectedConversation.id}
                customerPhone={selectedConversation.phone || ''}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-4 text-center">
                <Brain className="h-12 w-12 mb-2 text-accent-purple/50" />
                <p className="text-sm">Select a conversation to see supervisor AI analysis</p>
              </div>
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <MediaViewer
        open={mediaViewer.open}
        onOpenChange={(open) => setMediaViewer(prev => ({ ...prev, open }))}
        mediaUrl={mediaViewer.url}
        mediaType={mediaViewer.type}
        fileName={mediaViewer.fileName}
      />
    </div>
  );
};

export default Conversations;