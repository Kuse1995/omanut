import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { UserCog, Bot, Send, Sparkles, Paperclip, X, FileText, MessageSquare, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { QuickReplySelector } from './QuickReplySelector';
import { ChatBubble } from './ChatBubble';
import { DateDivider } from './DateDivider';
import { AgentSwitchIndicator } from './AgentSwitchIndicator';
import { LiveInsightsBar } from './LiveInsightsBar';
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

  useEffect(() => {
    scrollToBottom();
  }, [conversation.messages.length]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Avatar className="h-10 w-10 ring-2 ring-primary/20">
              <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                {getInitials()}
              </AvatarFallback>
            </Avatar>
            <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 bg-emerald-500 rounded-full border-2 border-card" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">
              {conversation.customer_name || conversation.phone || 'Unknown'}
            </h3>
            <div className="flex items-center gap-2">
              {conversation.human_takeover ? (
                <Badge variant="secondary" className="gap-1 h-5 text-[10px]">
                  <UserCog className="h-3 w-3" />
                  Human Control
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 h-5 text-[10px]">
                  <Bot className="h-3 w-3" />
                  AI Handling
                </Badge>
              )}
            </div>
          </div>
        </div>
        <Button
          variant={conversation.human_takeover ? "destructive" : "default"}
          size="sm"
          onClick={onToggleTakeover}
          className="font-medium"
        >
          {conversation.human_takeover ? "Release to AI" : "Take Over"}
        </Button>
      </div>

      {/* Live Insights Bar */}
      {showLiveInsights && (
        <LiveInsightsBar insight={liveInsight} isAnalyzing={isAnalyzing} />
      )}

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
        <div className="space-y-1 max-w-3xl mx-auto">
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
                />
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

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

      {/* Input Area */}
      {conversation.human_takeover && (
        <div className="p-4 border-t border-border bg-card/80 backdrop-blur-sm">
          {attachedFile && (
            <div className="flex items-center gap-2 mb-3 p-2 bg-secondary rounded-lg">
              <FileText className="h-4 w-4 text-primary" />
              <span className="text-sm flex-1 truncate">{attachedFile.name}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => onAttachFile(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          <div className="flex gap-2 items-end">
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 shrink-0"
                onClick={() => setShowQuickReplies(!showQuickReplies)}
                title="Quick Replies"
              >
                <MessageSquare className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 shrink-0"
                onClick={() => fileInputRef.current?.click()}
                title="Attach File"
              >
                <Paperclip className="h-5 w-5" />
              </Button>
            </div>
            <Input
              placeholder="Type a message..."
              value={messageInput}
              onChange={(e) => onMessageInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 min-h-10"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0"
              onClick={onGenerateImage}
              disabled={generatingImage || !messageInput.trim()}
              title="Generate Image"
            >
              <Sparkles className="h-5 w-5" />
            </Button>
            <Button
              onClick={onSendMessage}
              disabled={sendingMessage || (!messageInput.trim() && !attachedFile)}
              className="h-10 px-4"
            >
              <Send className="h-4 w-4" />
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
      )}

      {!conversation.human_takeover && (
        <div className="p-4 border-t border-border bg-secondary/50 text-center">
          <div className="flex items-center justify-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              AI is handling this conversation. Take over to send messages.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
