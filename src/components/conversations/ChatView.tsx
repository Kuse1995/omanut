import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';

import { UserCog, Bot, Send, Sparkles, Paperclip, X, FileText, MessageSquare, ChevronDown, Image, Facebook, MessageCircle as MessageCircleIcon } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { QuickReplySelector } from './QuickReplySelector';
import { ChatBubble } from './ChatBubble';
import { DateDivider } from './DateDivider';
import { AgentSwitchIndicator } from './AgentSwitchIndicator';
import { LiveInsightsBar } from './LiveInsightsBar';
import { MediaGallery } from './MediaGallery';
import { useLiveSupervisorAnalysis } from '@/hooks/useLiveSupervisorAnalysis';
interface Message {
  id: string;
  content: string;
  role: string;
  created_at: string;
  message_metadata?: any;
}

interface AgentSwitch {
  id: string;
  agent_type: string;
  routed_at: string;
  notes: string;
}

interface ChatViewProps {
  conversation: {
    id: string;
    customer_name: string | null;
    phone: string | null;
    status: string;
    human_takeover: boolean;
    messages: Message[];
    active_agent?: string;
    company_id?: string | null;
  };
  messageInput: string;
  onMessageInputChange: (value: string) => void;
  onSendMessage: () => void;
  onGenerateImage: () => void;
  onToggleTakeover: () => void;
  attachedFile: File | null;
  onAttachFile: (file: File | null) => void;
  sendingMessage: boolean;
  generatingImage: boolean;
  onMediaClick: (url: string, type: string, fileName?: string) => void;
  agentSwitches?: AgentSwitch[];
  showLiveInsights?: boolean;
}

export const ChatView = ({
  conversation,
  messageInput,
  onMessageInputChange,
  onSendMessage,
  onGenerateImage,
  onToggleTakeover,
  attachedFile,
  onAttachFile,
  sendingMessage,
  generatingImage,
  onMediaClick,
  agentSwitches = [],
  showLiveInsights = true
}: ChatViewProps) => {
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [showMediaGallery, setShowMediaGallery] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Live supervisor analysis
  const { liveInsight, isAnalyzing } = useLiveSupervisorAnalysis(
    conversation.id,
    conversation.company_id || null,
    conversation.messages
  );

  const getInitials = () => {
    if (conversation.customer_name) {
      return conversation.customer_name.substring(0, 2).toUpperCase();
    }
    return conversation.phone?.substring(0, 2) || '??';
  };

  const handleQuickReplySelect = (template: any) => {
    onMessageInputChange(template.content);
    setShowQuickReplies(false);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Auto-scroll when switching conversations or new messages arrive
  const lastConversationIdRef = useRef<string | null>(null);
  const isNearBottomRef = useRef(true);

  useEffect(() => {
    // Always scroll to bottom when switching to a different conversation
    if (lastConversationIdRef.current !== conversation.id) {
      lastConversationIdRef.current = conversation.id;
      // Use setTimeout to ensure DOM is updated
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      }, 0);
    } else if (isNearBottomRef.current) {
      // Only auto-scroll for new messages if already near bottom
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [conversation.id, conversation.messages.length]);

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSendMessage();
    }
  };

  const isFacebook = conversation.phone?.startsWith('fb:') && !conversation.phone?.startsWith('fbdm:');
  const isMessenger = conversation.phone?.startsWith('fbdm:');

  return (
    <div className="flex flex-col h-full min-h-0 bg-background relative">
      {/* Header */}
      <div className={cn(
        "flex items-center justify-between px-3 py-2 border-b border-border backdrop-blur-sm",
        isFacebook ? "bg-blue-50/80 dark:bg-blue-950/30" : 
        isMessenger ? "bg-violet-50/80 dark:bg-violet-950/30" : "bg-card/80"
      )}>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Avatar className={cn(
              "h-8 w-8 ring-2",
              isFacebook ? "ring-blue-500/30" : isMessenger ? "ring-violet-500/30" : "ring-primary/20"
            )}>
              <AvatarFallback className={cn(
                "font-semibold text-xs",
                isFacebook ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" : "bg-primary/10 text-primary"
              )}>
                {getInitials()}
              </AvatarFallback>
            </Avatar>
            {isFacebook ? (
              <div className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 bg-blue-600 rounded-full border-2 border-card flex items-center justify-center">
                <Facebook className="h-2 w-2 text-white" />
              </div>
            ) : (
              <div className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 bg-emerald-500 rounded-full border-2 border-card flex items-center justify-center">
                <MessageCircleIcon className="h-2 w-2 text-white" />
              </div>
            )}
          </div>
          <div>
            <h3 className="font-semibold text-xs">
              {conversation.customer_name || (isFacebook ? 'Facebook User' : conversation.phone) || 'Unknown'}
            </h3>
            <div className="flex items-center gap-1.5">
              <Badge 
                variant="outline" 
                className={cn(
                  "gap-0.5 h-4 text-[9px] px-1.5 border-0",
                  isFacebook 
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300" 
                    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
                )}
              >
                {isFacebook ? <Facebook className="h-2.5 w-2.5" /> : <MessageCircleIcon className="h-2.5 w-2.5" />}
                {isFacebook ? 'Facebook' : 'WhatsApp'}
              </Badge>
              {conversation.human_takeover ? (
                <Badge variant="secondary" className="gap-0.5 h-4 text-[9px] px-1.5">
                  <UserCog className="h-2.5 w-2.5" />
                  Human
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-0.5 h-4 text-[9px] px-1.5">
                  <Bot className="h-2.5 w-2.5" />
                  AI
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setShowMediaGallery(true)}
            title="Media Gallery"
          >
            <Image className="h-4 w-4" />
          </Button>
          {!isFacebook && (
            <Button
              variant={conversation.human_takeover ? "destructive" : "default"}
              size="sm"
              onClick={onToggleTakeover}
              className="font-medium h-7 text-xs px-2"
            >
              {conversation.human_takeover ? "Release" : "Take Over"}
            </Button>
          )}
        </div>
      </div>

      {/* Media Gallery Dialog */}
      <MediaGallery
        open={showMediaGallery}
        onOpenChange={setShowMediaGallery}
        messages={conversation.messages}
        onMediaClick={onMediaClick}
      />

      {/* Live Insights Bar */}
      {showLiveInsights && (
        <LiveInsightsBar insight={liveInsight} isAnalyzing={isAnalyzing} />
      )}

      {/* Messages */}
      <div 
        className="flex-1 min-h-0 overflow-y-auto p-3" 
        ref={scrollAreaRef}
        onScroll={handleScroll}
      >
        <div className="space-y-0 max-w-3xl mx-auto">
          {conversation.messages.map((message, idx) => {
            const showDateDivider = idx === 0 || 
              format(new Date(message.created_at), 'yyyy-MM-dd') !== 
              format(new Date(conversation.messages[idx - 1].created_at), 'yyyy-MM-dd');

            const relevantSwitches = agentSwitches.filter(sw => {
              const switchTime = new Date(sw.routed_at).getTime();
              const messageTime = new Date(message.created_at).getTime();
              const prevMessageTime = idx > 0 ? new Date(conversation.messages[idx - 1].created_at).getTime() : 0;
              return switchTime > prevMessageTime && switchTime <= messageTime;
            });

            // Determine grouping - messages from same sender within 2 minutes are grouped
            const prevMessage = idx > 0 ? conversation.messages[idx - 1] : null;
            const nextMessage = idx < conversation.messages.length - 1 ? conversation.messages[idx + 1] : null;
            
            const isSameAsPrev = prevMessage && 
              prevMessage.role === message.role &&
              (new Date(message.created_at).getTime() - new Date(prevMessage.created_at).getTime()) < 120000;
            
            const isSameAsNext = nextMessage && 
              nextMessage.role === message.role &&
              (new Date(nextMessage.created_at).getTime() - new Date(message.created_at).getTime()) < 120000;
            
            const isFirstInGroup = !isSameAsPrev || showDateDivider || relevantSwitches.length > 0;
            const isLastInGroup = !isSameAsNext;

            return (
              <div key={message.id}>
                {showDateDivider && <DateDivider date={message.created_at} />}
                
                {relevantSwitches.map(sw => (
                  <AgentSwitchIndicator 
                    key={sw.id} 
                    agentType={sw.agent_type} 
                    notes={sw.notes} 
                  />
                ))}
                
                <ChatBubble
                  content={message.content}
                  role={message.role as 'user' | 'assistant'}
                  timestamp={message.created_at}
                  metadata={message.message_metadata}
                  onMediaClick={onMediaClick}
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
          className="absolute bottom-24 right-8 rounded-full shadow-lg h-8 w-8"
          onClick={scrollToBottom}
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
      )}

      {/* Quick Reply Selector */}
      {showQuickReplies && conversation.human_takeover && (
        <div className="border-t border-border animate-fade-in">
          <QuickReplySelector onSelect={handleQuickReplySelect} />
        </div>
      )}

      {/* Input Area - Platform-adaptive */}
      {isFacebook ? (
        <div className="px-3 py-2 border-t border-border bg-blue-50/50 dark:bg-blue-950/20 text-center">
          <div className="flex items-center justify-center gap-1.5">
            <Facebook className="h-3.5 w-3.5 text-blue-500" />
            <p className="text-xs text-muted-foreground">
              Facebook comments are handled automatically by AI. Replies appear as public comments.
            </p>
          </div>
        </div>
      ) : conversation.human_takeover ? (
        <div className="px-3 py-2 border-t border-border bg-card/80 backdrop-blur-sm">
          {attachedFile && (
            <div className="flex items-center gap-2 mb-2 p-1.5 bg-secondary rounded-lg">
              <FileText className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs flex-1 truncate">{attachedFile.name}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0"
                onClick={() => onAttachFile(null)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}

          <div className="flex gap-1.5 items-end">
            <div className="flex gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => setShowQuickReplies(!showQuickReplies)}
                title="Quick Replies"
              >
                <MessageSquare className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => fileInputRef.current?.click()}
                title="Attach File"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
            </div>
            <Input
              placeholder="Type a WhatsApp message..."
              value={messageInput}
              onChange={(e) => onMessageInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 h-8 text-sm"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={onGenerateImage}
              disabled={generatingImage || !messageInput.trim()}
              title="Generate Image"
            >
              <Sparkles className="h-4 w-4" />
            </Button>
            <Button
              onClick={onSendMessage}
              disabled={sendingMessage || (!messageInput.trim() && !attachedFile)}
              className="h-8 px-3"
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*,video/*,application/pdf"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onAttachFile(file);
            }}
          />
        </div>
      ) : (
        <div className="px-3 py-2 border-t border-border bg-secondary/50 text-center">
          <div className="flex items-center justify-center gap-1.5">
            <Bot className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              AI is handling this conversation. Take over to send messages.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
