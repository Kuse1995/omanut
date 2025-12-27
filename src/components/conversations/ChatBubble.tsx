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
  // Grouping props
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
  showTimestamp?: boolean;
}

export const ChatBubble = ({
  content,
  role,
  timestamp,
  metadata,
  onMediaClick,
  showReadReceipt = true,
  isDelivered = true,
  isFirstInGroup = true,
  isLastInGroup = true,
  showTimestamp = true
}: ChatBubbleProps) => {
  const isUser = role === 'user';

  const renderMedia = () => {
    if (!metadata?.media_url) return null;

    const mediaType = metadata.media_type || 'image/jpeg';
    const fileName = metadata.file_name || 'file';

    if (mediaType.startsWith('image')) {
      return (
        <div 
          className="cursor-pointer hover:opacity-90 transition-opacity mb-1.5 group relative"
          onClick={() => onMediaClick?.(metadata.media_url!, mediaType.includes('/') ? mediaType : 'image/jpeg', fileName)}
        >
          <img 
            src={metadata.media_url} 
            alt="Shared" 
            className="max-w-full rounded-lg max-h-48 object-cover" 
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 rounded-lg transition-colors flex items-center justify-center">
            <ImageIcon className="h-6 w-6 text-white opacity-0 group-hover:opacity-80 transition-opacity drop-shadow-lg" />
          </div>
        </div>
      );
    } else if (mediaType.startsWith('video')) {
      return (
        <div 
          className="cursor-pointer hover:opacity-90 transition-opacity mb-1.5"
          onClick={() => onMediaClick?.(metadata.media_url!, mediaType.includes('/') ? mediaType : 'video/mp4', fileName)}
        >
          <div className="flex items-center gap-2 p-2 bg-black/10 rounded-lg">
            <Video className="h-4 w-4 text-primary" />
            <span className="text-xs truncate max-w-40">{fileName}</span>
          </div>
        </div>
      );
    } else if (mediaType === 'application/pdf' || mediaType === 'pdf') {
      return (
        <div 
          className="cursor-pointer hover:opacity-90 transition-opacity mb-1.5"
          onClick={() => onMediaClick?.(metadata.media_url!, 'application/pdf', fileName)}
        >
          <div className="flex items-center gap-2 p-2 bg-black/10 rounded-lg">
            <FileText className="h-4 w-4 text-destructive" />
            <span className="text-xs truncate max-w-40">{fileName}</span>
          </div>
        </div>
      );
    } else if (mediaType.startsWith('audio')) {
      return (
        <div 
          className="cursor-pointer hover:opacity-90 transition-opacity mb-1.5"
          onClick={() => onMediaClick?.(metadata.media_url!, mediaType.includes('/') ? mediaType : 'audio/mpeg', fileName)}
        >
          <div className="flex items-center gap-2 p-2 bg-black/10 rounded-lg">
            <Music className="h-4 w-4 text-accent" />
            <span className="text-xs truncate max-w-40">{fileName}</span>
          </div>
        </div>
      );
    }

    return null;
  };

  // Dynamic border radius based on grouping
  const getBorderRadius = () => {
    if (isUser) {
      // User messages (left side)
      if (isFirstInGroup && isLastInGroup) return 'rounded-xl rounded-bl-sm';
      if (isFirstInGroup) return 'rounded-xl rounded-bl-md';
      if (isLastInGroup) return 'rounded-xl rounded-tl-md rounded-bl-sm';
      return 'rounded-xl rounded-l-md';
    } else {
      // Assistant messages (right side)
      if (isFirstInGroup && isLastInGroup) return 'rounded-xl rounded-br-sm';
      if (isFirstInGroup) return 'rounded-xl rounded-br-md';
      if (isLastInGroup) return 'rounded-xl rounded-tr-md rounded-br-sm';
      return 'rounded-xl rounded-r-md';
    }
  };

  return (
    <div className={cn(
      "flex", 
      isUser ? "justify-start" : "justify-end",
      isLastInGroup ? "mb-1.5" : "mb-0.5"
    )}>
      <div
        className={cn(
          "max-w-[80%] px-3 py-1.5 relative shadow-sm",
          getBorderRadius(),
          isUser 
            ? "bg-secondary text-secondary-foreground" 
            : "bg-primary text-primary-foreground"
        )}
      >
        {/* WhatsApp-style tail - only show on first message in group */}
        {isFirstInGroup && (
          <div
            className={cn(
              "absolute top-0 w-3 h-3",
              isUser 
                ? "-left-1.5 border-l-8 border-l-transparent border-t-8 border-t-secondary" 
                : "-right-1.5 border-r-8 border-r-transparent border-t-8 border-t-primary"
            )}
          />
        )}
        
        {renderMedia()}
        
        {content && (
          <p className="text-sm whitespace-pre-wrap break-words leading-snug">
            {content}
          </p>
        )}
        
        {/* Only show timestamp on last message of group */}
        {showTimestamp && isLastInGroup && (
          <div className={cn(
            "flex items-center gap-1 mt-0.5",
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
        )}
      </div>
    </div>
  );
};
