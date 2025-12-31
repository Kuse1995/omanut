import { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageCircle, MessageSquare, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCompany } from '@/context/CompanyContext';
import { InboxItem } from './InboxItem';
import { AIReplyPanel } from './AIReplyPanel';

interface FacebookMessage {
  id: string;
  sender_psid: string;
  message_text: string | null;
  page_id: string;
  created_at: string;
  is_processed: boolean;
}

interface FacebookComment {
  id: string;
  comment_id: string;
  commenter_name: string | null;
  comment_text: string | null;
  page_id: string;
  post_id: string | null;
  created_at: string;
}

interface ReplyDraft {
  id: string;
  source_type: string;
  source_id: string;
  ai_reply: string;
  status: string;
  created_at: string;
}

export function CompanyInbox() {
  const { selectedCompany } = useCompany();
  const [activeTab, setActiveTab] = useState<'messages' | 'comments'>('messages');
  const [messages, setMessages] = useState<FacebookMessage[]>([]);
  const [comments, setComments] = useState<FacebookComment[]>([]);
  const [drafts, setDrafts] = useState<ReplyDraft[]>([]);
  const [selectedItem, setSelectedItem] = useState<{ type: 'message' | 'comment'; item: FacebookMessage | FacebookComment } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (selectedCompany?.id) {
      fetchInboxData();
    }
  }, [selectedCompany?.id]);

  const fetchInboxData = async () => {
    if (!selectedCompany?.id) return;
    
    setIsLoading(true);
    try {
      // Fetch Facebook messages - these are stored in facebook_messages table
      // which gets populated by the meta-webhook
      const { data: messagesData, error: messagesError } = await supabase
        .from('facebook_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (!messagesError && messagesData) {
        setMessages(messagesData as FacebookMessage[]);
      }

      // Note: facebook_comments table needs to be created separately
      // For now, we'll set empty array
      setComments([]);

      // Fetch reply drafts for this company
      const { data: draftsData, error: draftsError } = await supabase
        .from('message_reply_drafts')
        .select('*')
        .eq('company_id', selectedCompany.id)
        .order('created_at', { ascending: false });

      if (!draftsError && draftsData) {
        setDrafts(draftsData as ReplyDraft[]);
      }
    } catch (error) {
      console.error('Error fetching inbox data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getDraftForItem = (type: 'message' | 'comment', itemId: string) => {
    const sourceType = type === 'message' ? 'facebook_message' : 'facebook_comment';
    return drafts.find(d => d.source_type === sourceType && d.source_id === itemId);
  };

  const getStatusBadge = (type: 'message' | 'comment', itemId: string) => {
    const draft = getDraftForItem(type, itemId);
    
    if (!draft) {
      return <Badge variant="outline" className="text-muted-foreground">Unreplied</Badge>;
    }
    
    switch (draft.status) {
      case 'draft':
        return <Badge variant="secondary">AI Draft Ready</Badge>;
      case 'approved':
        return <Badge className="bg-yellow-500">Approved</Badge>;
      case 'sent':
        return <Badge className="bg-green-500">Replied</Badge>;
      case 'rejected':
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const handleItemSelect = (type: 'message' | 'comment', item: FacebookMessage | FacebookComment) => {
    setSelectedItem({ type, item });
  };

  const handleDraftUpdated = () => {
    fetchInboxData();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
      {/* Left side: Inbox list */}
      <Card className="h-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold">Unified Inbox</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'messages' | 'comments')}>
            <TabsList className="w-full rounded-none border-b">
              <TabsTrigger value="messages" className="flex-1 gap-2">
                <MessageCircle className="h-4 w-4" />
                Messages
                {messages.length > 0 && (
                  <Badge variant="secondary" className="ml-1">{messages.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="comments" className="flex-1 gap-2">
                <MessageSquare className="h-4 w-4" />
                Comments
                {comments.length > 0 && (
                  <Badge variant="secondary" className="ml-1">{comments.length}</Badge>
                )}
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="messages" className="m-0">
              <ScrollArea className="h-[500px]">
                {messages.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    No Facebook messages yet
                  </div>
                ) : (
                  <div className="divide-y">
                    {messages.map((message) => (
                      <InboxItem
                        key={message.id}
                        type="message"
                        sender={message.sender_psid}
                        content={message.message_text || ''}
                        timestamp={message.created_at}
                        statusBadge={getStatusBadge('message', message.id)}
                        isSelected={selectedItem?.type === 'message' && selectedItem.item.id === message.id}
                        onClick={() => handleItemSelect('message', message)}
                      />
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
            
            <TabsContent value="comments" className="m-0">
              <ScrollArea className="h-[500px]">
                {comments.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    No Facebook comments yet
                  </div>
                ) : (
                  <div className="divide-y">
                    {comments.map((comment) => (
                      <InboxItem
                        key={comment.id}
                        type="comment"
                        sender={comment.commenter_name || 'Unknown'}
                        content={comment.comment_text || ''}
                        timestamp={comment.created_at}
                        statusBadge={getStatusBadge('comment', comment.id)}
                        isSelected={selectedItem?.type === 'comment' && selectedItem.item.id === comment.id}
                        onClick={() => handleItemSelect('comment', comment)}
                      />
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Right side: AI Reply Panel */}
      <Card className="h-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold">Reply Management</CardTitle>
        </CardHeader>
        <CardContent>
          {selectedItem ? (
            <AIReplyPanel
              sourceType={selectedItem.type === 'message' ? 'facebook_message' : 'facebook_comment'}
              sourceId={selectedItem.item.id}
              companyId={selectedCompany?.id || ''}
              originalContent={
                selectedItem.type === 'message' 
                  ? (selectedItem.item as FacebookMessage).message_text || ''
                  : (selectedItem.item as FacebookComment).comment_text || ''
              }
              senderName={
                selectedItem.type === 'message'
                  ? (selectedItem.item as FacebookMessage).sender_psid
                  : (selectedItem.item as FacebookComment).commenter_name || 'Unknown'
              }
              existingDraft={getDraftForItem(
                selectedItem.type,
                selectedItem.item.id
              )}
              onDraftUpdated={handleDraftUpdated}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <MessageCircle className="h-12 w-12 mb-4 opacity-50" />
              <p>Select a message or comment to manage replies</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
