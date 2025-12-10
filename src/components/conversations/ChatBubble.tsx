import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Check, CheckCheck, Video, FileText, Image as ImageIcon, Music } from 'lucide-react';

interface ChatBubbleProps {
  content: string;
  role: 'user' | 'assistant';
  timestamp: string;
  metadata?: {
    media_url?: string;
    media_type?: string;
    file_name?: string;
  };
  onMediaClick?: (url: string, type: string, fileName?: string) => void;
  showReadReceipt?: boolean;
  isDelivered?: boolean;
}

export const ChatBubble = ({
  content,
  role,
  timestamp,
  metadata,
  onMediaClick,
  showReadReceipt = true,
  isDelivered = true
}: ChatBubbleProps) => {
  const isUser = role === 'user';

  const renderMedia = () => {
    if (!metadata?.media_url) return null;

    const mediaType = metadata.media_type || 'image';
    const fileName = metadata.file_name || 'file';

    if (mediaType.startsWith('image')) {
      return (
        <div 
          className="cursor-pointer hover:opacity-90 transition-opacity mb-2"
          onClick={() => onMediaClick?.(metadata.media_url!, 'image', fileName)}
        >
          <img 
            src={metadata.media_url} 
            alt="Shared" 
            className="max-w-full rounded-lg max-h-64 object-cover" 
          />
        </div>
      );
    } else if (mediaType.startsWith('video')) {
      return (
        <div 
          className="cursor-pointer hover:opacity-90 transition-opacity mb-2"
          onClick={() => onMediaClick?.(metadata.media_url!, 'video', fileName)}
        >
          <div className="flex items-center gap-2 p-3 bg-secondary/50 rounded-lg">
            <Video className="h-5 w-5 text-primary" />
            <span className="text-sm truncate max-w-48">{fileName}</span>
          </div>
        </div>
      );
    } else if (mediaType === 'application/pdf') {
      return (
        <div 
          className="cursor-pointer hover:opacity-90 transition-opacity mb-2"
          onClick={() => onMediaClick?.(metadata.media_url!, 'pdf', fileName)}
        >
          <div className="flex items-center gap-2 p-3 bg-secondary/50 rounded-lg">
            <FileText className="h-5 w-5 text-destructive" />
            <span className="text-sm truncate max-w-48">{fileName}</span>
          </div>
        </div>
      );
    } else if (mediaType.startsWith('audio')) {
      return (
        <div className="flex items-center gap-2 p-3 bg-secondary/50 rounded-lg mb-2">
          <Music className="h-5 w-5 text-accent" />
          <span className="text-sm truncate max-w-48">{fileName}</span>
        </div>
      );
    }

    return null;
  };

  return (
    <div className={cn("flex mb-3", isUser ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-4 py-2 relative shadow-sm",
          isUser 
            ? "bg-secondary text-secondary-foreground rounded-bl-md" 
            : "bg-primary text-primary-foreground rounded-br-md"
        )}
      >
        {/* WhatsApp-style tail */}
        <div
          className={cn(
            "absolute top-0 w-3 h-3",
            isUser 
              ? "-left-1.5 border-l-8 border-l-transparent border-t-8 border-t-secondary" 
              : "-right-1.5 border-r-8 border-r-transparent border-t-8 border-t-primary"
          )}
        />
        
        {renderMedia()}
        
        {content && (
          <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
            {content}
          </p>
        )}
        
        <div className={cn(
          "flex items-center gap-1 mt-1",
          isUser ? "justify-start" : "justify-end"
        )}>
          <span className={cn(
            "text-[10px]",
            isUser ? "text-muted-foreground" : "text-primary-foreground/70"
          )}>
            {format(new Date(timestamp), 'HH:mm')}
          </span>
          {!isUser && showReadReceipt && (
            isDelivered ? (
              <CheckCheck className="h-3.5 w-3.5 text-primary-foreground/70" />
            ) : (
              <Check className="h-3.5 w-3.5 text-primary-foreground/70" />
            )
          )}
        </div>
      </div>
    </div>
  );
};
