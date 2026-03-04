import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Check, CheckCheck, Video, FileText, Image as ImageIcon, Music, Facebook, MessageCircle, ExternalLink } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Badge } from '@/components/ui/badge';

interface ChatBubbleProps {
  content: string;
  role: 'user' | 'assistant';
  timestamp: string;
  metadata?: {
    media_url?: string;
    media_type?: string;
    file_name?: string;
    source?: string;
    comment_id?: string;
    reply_id?: string;
  };
  onMediaClick?: (url: string, type: string, fileName?: string) => void;
  showReadReceipt?: boolean;
  isDelivered?: boolean;
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
  showTimestamp?: boolean;
}

// Extract URLs from text for link previews
const URL_REGEX = /https?:\/\/[^\s<]+/g;

const LinkPreview = ({ url }: { url: string }) => {
  const domain = new URL(url).hostname.replace('www.', '');
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 p-2 mt-1 rounded-lg bg-black/5 hover:bg-black/10 transition-colors border border-black/5 group"
    >
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium truncate opacity-80">{domain}</p>
        <p className="text-[10px] opacity-50 truncate">{url}</p>
      </div>
      <ExternalLink className="h-3 w-3 opacity-40 group-hover:opacity-70 shrink-0 transition-opacity" />
    </a>
  );
};

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
  const isFacebook = metadata?.source === 'facebook';
  const urls = content?.match(URL_REGEX) || [];

  const renderMedia = () => {
    if (!metadata?.media_url) return null;

    const mediaType = metadata.media_type || 'image/jpeg';
    const fileName = metadata.file_name || 'file';

    if (mediaType.startsWith('image')) {
      return (
        <div 
          className="cursor-pointer hover:opacity-90 transition-opacity mb-1.5 group relative overflow-hidden rounded-lg"
          onClick={() => onMediaClick?.(metadata.media_url!, mediaType.includes('/') ? mediaType : 'image/jpeg', fileName)}
        >
          <img 
            src={metadata.media_url} 
            alt="Shared" 
            className="max-w-full rounded-lg max-h-64 object-cover w-full" 
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-0 group-hover:opacity-100 rounded-lg transition-opacity flex items-end justify-center pb-2">
            <span className="text-white text-[10px] font-medium flex items-center gap-1">
              <ImageIcon className="h-3 w-3" /> View
            </span>
          </div>
        </div>
      );
    } else if (mediaType.startsWith('video')) {
      return (
        <div 
          className="cursor-pointer hover:opacity-90 transition-opacity mb-1.5"
          onClick={() => onMediaClick?.(metadata.media_url!, mediaType.includes('/') ? mediaType : 'video/mp4', fileName)}
        >
          <div className="flex items-center gap-2.5 p-2.5 bg-black/5 rounded-lg border border-black/5">
            <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              <Video className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-xs font-medium truncate block">{fileName}</span>
              <span className="text-[10px] opacity-50">Video</span>
            </div>
          </div>
        </div>
      );
    } else if (mediaType === 'application/pdf' || mediaType === 'pdf') {
      return (
        <div 
          className="cursor-pointer hover:opacity-90 transition-opacity mb-1.5"
          onClick={() => onMediaClick?.(metadata.media_url!, 'application/pdf', fileName)}
        >
          <div className="flex items-center gap-2.5 p-2.5 bg-black/5 rounded-lg border border-black/5">
            <div className="h-8 w-8 rounded-md bg-destructive/10 flex items-center justify-center shrink-0">
              <FileText className="h-4 w-4 text-destructive" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-xs font-medium truncate block">{fileName}</span>
              <span className="text-[10px] opacity-50">PDF Document</span>
            </div>
          </div>
        </div>
      );
    } else if (mediaType.startsWith('audio')) {
      return (
        <div 
          className="cursor-pointer hover:opacity-90 transition-opacity mb-1.5"
          onClick={() => onMediaClick?.(metadata.media_url!, mediaType.includes('/') ? mediaType : 'audio/mpeg', fileName)}
        >
          <div className="flex items-center gap-2.5 p-2.5 bg-black/5 rounded-lg border border-black/5">
            <div className="h-8 w-8 rounded-md bg-accent/10 flex items-center justify-center shrink-0">
              <Music className="h-4 w-4 text-accent" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-xs font-medium truncate block">{fileName}</span>
              <span className="text-[10px] opacity-50">Audio</span>
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  const getBorderRadius = () => {
    if (isUser) {
      if (isFirstInGroup && isLastInGroup) return 'rounded-xl rounded-bl-sm';
      if (isFirstInGroup) return 'rounded-xl rounded-bl-md';
      if (isLastInGroup) return 'rounded-xl rounded-tl-md rounded-bl-sm';
      return 'rounded-xl rounded-l-md';
    } else {
      if (isFirstInGroup && isLastInGroup) return 'rounded-xl rounded-br-sm';
      if (isFirstInGroup) return 'rounded-xl rounded-br-md';
      if (isLastInGroup) return 'rounded-xl rounded-tr-md rounded-br-sm';
      return 'rounded-xl rounded-r-md';
    }
  };

  // Platform-specific bubble styling
  const getBubbleStyle = () => {
    if (isUser) {
      if (isFacebook) {
        return "bg-blue-50 dark:bg-blue-950/40 text-foreground border border-blue-200/50 dark:border-blue-800/30";
      }
      return "bg-secondary text-secondary-foreground";
    } else {
      if (isFacebook) {
        return "bg-blue-600 text-white";
      }
      return "bg-primary text-primary-foreground";
    }
  };

  const getTailStyle = () => {
    if (isUser) {
      if (isFacebook) return "border-t-blue-50 dark:border-t-blue-950/40";
      return "border-t-secondary";
    } else {
      if (isFacebook) return "border-t-blue-600";
      return "border-t-primary";
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
          getBubbleStyle()
        )}
      >
        {/* Tail */}
        {isFirstInGroup && (
          <div
            className={cn(
              "absolute top-0 w-3 h-3",
              isUser 
                ? cn("-left-1.5 border-l-8 border-l-transparent border-t-8", getTailStyle())
                : cn("-right-1.5 border-r-8 border-r-transparent border-t-8", getTailStyle())
            )}
          />
        )}

        {/* Platform source badge - only on first message in group */}
        {isFirstInGroup && isFacebook && (
          <div className="flex items-center gap-1 mb-1">
            <Facebook className="h-2.5 w-2.5" />
            <span className="text-[9px] font-medium opacity-70">
              {isUser ? 'Facebook Comment' : 'Auto-reply'}
            </span>
          </div>
        )}
        
        {renderMedia()}
        
        {content && (
          <div className="text-sm whitespace-pre-wrap break-words leading-snug prose prose-sm max-w-none prose-p:my-0 prose-headings:my-1">
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="mb-0">{children}</p>,
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-80">
                    {children}
                  </a>
                ),
                strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                em: ({ children }) => <em>{children}</em>,
                ul: ({ children }) => <ul className="list-disc pl-4 my-0.5">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal pl-4 my-0.5">{children}</ol>,
                li: ({ children }) => <li className="my-0">{children}</li>,
                code: ({ children }) => (
                  <code className="bg-black/10 rounded px-1 py-0.5 text-[12px] font-mono">{children}</code>
                ),
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        )}

        {/* Link previews */}
        {urls.length > 0 && urls.slice(0, 2).map((url, i) => (
          <LinkPreview key={i} url={url} />
        ))}
        
        {/* Timestamp & read receipt */}
        {showTimestamp && isLastInGroup && (
          <div className={cn(
            "flex items-center gap-1 mt-0.5",
            isUser ? "justify-start" : "justify-end"
          )}>
            {isFacebook && (
              <Facebook className={cn("h-2.5 w-2.5", isUser ? "text-blue-500" : "opacity-70")} />
            )}
            {!isFacebook && !isUser && (
              <MessageCircle className="h-2.5 w-2.5 opacity-70" />
            )}
            <span className={cn(
              "text-[10px]",
              isUser ? "text-muted-foreground" : (isFacebook ? "text-white/70" : "text-primary-foreground/70")
            )}>
              {format(new Date(timestamp), 'HH:mm')}
            </span>
            {!isUser && showReadReceipt && !isFacebook && (
              isDelivered ? (
                <CheckCheck className={cn("h-3.5 w-3.5", isFacebook ? "text-white/70" : "text-primary-foreground/70")} />
              ) : (
                <Check className={cn("h-3.5 w-3.5", isFacebook ? "text-white/70" : "text-primary-foreground/70")} />
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
};