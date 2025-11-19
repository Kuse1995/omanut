import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { UserCog, Bot, Send, Sparkles, Paperclip, X, Image as ImageIcon, Video, FileText, MessageSquare } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { QuickReplySelector } from './QuickReplySelector';

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
  agentSwitches = []
}: ChatViewProps) => {
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  const getAgentLabel = (agentType: string) => {
    switch (agentType) {
      case 'support': return { label: 'Support Agent', color: 'bg-blue-500/20 text-blue-400' };
      case 'sales': return { label: 'Sales Agent', color: 'bg-green-500/20 text-green-400' };
      case 'boss': return { label: 'Human Handoff', color: 'bg-amber-500/20 text-amber-400' };
      default: return { label: agentType, color: 'bg-muted text-muted-foreground' };
    }
  };

  const renderAgentSwitch = (agentSwitch: AgentSwitch) => {
    const agentInfo = getAgentLabel(agentSwitch.agent_type);
    const isSwitch = agentSwitch.notes.includes('Agent switch:');
    
    return (
      <div key={agentSwitch.id} className="flex justify-center my-4">
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-muted/50 text-xs text-muted-foreground">
          <div className={cn("w-2 h-2 rounded-full", agentInfo.color)} />
          {isSwitch ? (
            <span>🔄 Switched to <span className="font-semibold">{agentInfo.label}</span></span>
          ) : (
            <span>Routed to <span className="font-semibold">{agentInfo.label}</span></span>
          )}
        </div>
      </div>
    );
  };

  const renderMessageContent = (message: Message) => {
    const metadata = message.message_metadata;

    if (metadata?.media_url) {
      const mediaType = metadata.media_type || 'image';
      const fileName = metadata.file_name || 'file';

      if (mediaType.startsWith('image')) {
        return (
          <div 
            className="cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => onMediaClick(metadata.media_url, 'image', fileName)}
          >
            <img src={metadata.media_url} alt="Shared" className="max-w-xs rounded-lg" />
          </div>
        );
      } else if (mediaType.startsWith('video')) {
        return (
          <div 
            className="cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => onMediaClick(metadata.media_url, 'video', fileName)}
          >
            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <Video className="h-5 w-5" />
              <span className="text-sm">{fileName}</span>
            </div>
          </div>
        );
      } else if (mediaType === 'application/pdf') {
        return (
          <div 
            className="cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => onMediaClick(metadata.media_url, 'pdf', fileName)}
          >
            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <FileText className="h-5 w-5" />
              <span className="text-sm">{fileName}</span>
            </div>
          </div>
        );
      }
    }

    return <p className="whitespace-pre-wrap break-words">{message.content}</p>;
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-primary/10 text-primary font-semibold">
              {getInitials()}
            </AvatarFallback>
          </Avatar>
          <div>
            <h3 className="font-semibold">
              {conversation.customer_name || conversation.phone || 'Unknown'}
            </h3>
            <div className="flex items-center gap-2">
              {conversation.human_takeover ? (
                <Badge variant="secondary" className="gap-1">
                  <UserCog className="h-3 w-3" />
                  <span className="text-xs">Human Control</span>
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1">
                  <Bot className="h-3 w-3" />
                  <span className="text-xs">AI Handling</span>
                </Badge>
              )}
            </div>
          </div>
        </div>
        <Button
          variant={conversation.human_takeover ? "destructive" : "default"}
          size="sm"
          onClick={onToggleTakeover}
        >
          {conversation.human_takeover ? "Release to AI" : "Take Over"}
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {conversation.messages.map((message, idx) => {
            const isUser = message.role === 'user';
            const showDateDivider = idx === 0 || 
              format(new Date(message.created_at), 'yyyy-MM-dd') !== 
              format(new Date(conversation.messages[idx - 1].created_at), 'yyyy-MM-dd');

            // Find agent switches that occurred just before this message
            const relevantSwitches = agentSwitches.filter(sw => {
              const switchTime = new Date(sw.routed_at).getTime();
              const messageTime = new Date(message.created_at).getTime();
              const prevMessageTime = idx > 0 ? new Date(conversation.messages[idx - 1].created_at).getTime() : 0;
              return switchTime > prevMessageTime && switchTime <= messageTime;
            });

            return (
              <div key={message.id}>
                {showDateDivider && (
                  <div className="flex items-center justify-center my-4">
                    <div className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
                      {format(new Date(message.created_at), 'MMMM d, yyyy')}
                    </div>
                  </div>
                )}
                
                {/* Show agent switches that occurred before this message */}
                {relevantSwitches.map(sw => renderAgentSwitch(sw))}
                
                <div className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")}>
                  <div className={cn(
                    "max-w-[70%] rounded-lg p-3",
                    isUser 
                      ? "bg-primary text-primary-foreground" 
                      : "bg-muted"
                  )}>
                    {renderMessageContent(message)}
                    <p className="text-xs mt-1 opacity-70">
                      {format(new Date(message.created_at), 'HH:mm')}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Quick Reply Selector */}
      {showQuickReplies && conversation.human_takeover && (
        <div className="border-t border-border">
          <QuickReplySelector onSelect={handleQuickReplySelect} />
        </div>
      )}

      {/* Input Area */}
      {conversation.human_takeover && (
        <div className="p-4 border-t border-border bg-card">
          {attachedFile && (
            <div className="flex items-center gap-2 mb-2 p-2 bg-muted rounded-lg">
              <FileText className="h-4 w-4" />
              <span className="text-sm flex-1 truncate">{attachedFile.name}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAttachFile(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setShowQuickReplies(!showQuickReplies)}
              title="Quick Replies"
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              title="Attach File"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <Input
              placeholder="Type a message..."
              value={messageInput}
              onChange={(e) => onMessageInputChange(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && onSendMessage()}
              className="flex-1"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={onGenerateImage}
              disabled={generatingImage || !messageInput.trim()}
              title="Generate Image"
            >
              <Sparkles className="h-4 w-4" />
            </Button>
            <Button
              onClick={onSendMessage}
              disabled={sendingMessage || (!messageInput.trim() && !attachedFile)}
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
        <div className="p-4 border-t border-border bg-muted/50 text-center">
          <p className="text-sm text-muted-foreground">
            AI is currently handling this conversation. Take over to send messages.
          </p>
        </div>
      )}
    </div>
  );
};
