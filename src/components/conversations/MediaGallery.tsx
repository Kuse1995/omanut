import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Image, Video, FileAudio, FileText, X, Download, Grid3X3, List } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface MediaItem {
  id: string;
  url: string;
  type: string;
  fileName?: string;
  timestamp: string;
  sender: 'user' | 'assistant';
}

interface MediaGalleryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messages: Array<{
    id: string;
    content: string;
    role: string;
    created_at: string;
    message_metadata?: any;
  }>;
  onMediaClick: (url: string, type: string, fileName?: string) => void;
}

type FilterType = 'all' | 'images' | 'videos' | 'audio' | 'documents';

export const MediaGallery = ({ 
  open, 
  onOpenChange, 
  messages,
  onMediaClick 
}: MediaGalleryProps) => {
  const [filter, setFilter] = useState<FilterType>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Extract all media from messages
  const mediaItems = useMemo(() => {
    const items: MediaItem[] = [];
    
    messages.forEach(msg => {
      const metadata = msg.message_metadata;
      if (metadata?.media_url && metadata?.media_type) {
        items.push({
          id: msg.id,
          url: metadata.media_url,
          type: metadata.media_type,
          fileName: metadata.file_name,
          timestamp: msg.created_at,
          sender: msg.role as 'user' | 'assistant'
        });
      }
    });
    
    return items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [messages]);

  // Filter media items
  const filteredItems = useMemo(() => {
    if (filter === 'all') return mediaItems;
    
    return mediaItems.filter(item => {
      const type = item.type.toLowerCase();
      switch (filter) {
        case 'images':
          return type.startsWith('image') || type === 'image';
        case 'videos':
          return type.startsWith('video') || type === 'video';
        case 'audio':
          return type.startsWith('audio') || type === 'audio';
        case 'documents':
          return type === 'application/pdf' || type === 'pdf' || 
                 type.includes('document') || type.includes('text');
        default:
          return true;
      }
    });
  }, [mediaItems, filter]);

  // Get counts for each type
  const counts = useMemo(() => {
    const result = { all: mediaItems.length, images: 0, videos: 0, audio: 0, documents: 0 };
    
    mediaItems.forEach(item => {
      const type = item.type.toLowerCase();
      if (type.startsWith('image') || type === 'image') result.images++;
      else if (type.startsWith('video') || type === 'video') result.videos++;
      else if (type.startsWith('audio') || type === 'audio') result.audio++;
      else result.documents++;
    });
    
    return result;
  }, [mediaItems]);

  const getMediaIcon = (type: string) => {
    const t = type.toLowerCase();
    if (t.startsWith('image') || t === 'image') return <Image className="h-4 w-4" />;
    if (t.startsWith('video') || t === 'video') return <Video className="h-4 w-4" />;
    if (t.startsWith('audio') || t === 'audio') return <FileAudio className="h-4 w-4" />;
    return <FileText className="h-4 w-4" />;
  };

  const getMediaPreview = (item: MediaItem) => {
    const type = item.type.toLowerCase();
    const isImage = type.startsWith('image') || type === 'image';
    const isVideo = type.startsWith('video') || type === 'video';

    if (isImage) {
      return (
        <img 
          src={item.url} 
          alt="Media" 
          className="w-full h-full object-cover"
        />
      );
    }

    if (isVideo) {
      return (
        <div className="relative w-full h-full bg-secondary flex items-center justify-center">
          <Video className="h-8 w-8 text-muted-foreground" />
          <div className="absolute bottom-1 right-1">
            <Badge variant="secondary" className="text-[10px] px-1 py-0">
              Video
            </Badge>
          </div>
        </div>
      );
    }

    return (
      <div className="w-full h-full bg-secondary flex flex-col items-center justify-center gap-1">
        {getMediaIcon(item.type)}
        <span className="text-[10px] text-muted-foreground truncate max-w-full px-1">
          {item.fileName || 'File'}
        </span>
      </div>
    );
  };

  const filterButtons: { key: FilterType; label: string; icon: React.ReactNode }[] = [
    { key: 'all', label: 'All', icon: <Grid3X3 className="h-3 w-3" /> },
    { key: 'images', label: 'Images', icon: <Image className="h-3 w-3" /> },
    { key: 'videos', label: 'Videos', icon: <Video className="h-3 w-3" /> },
    { key: 'audio', label: 'Audio', icon: <FileAudio className="h-3 w-3" /> },
    { key: 'documents', label: 'Docs', icon: <FileText className="h-3 w-3" /> },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0">
        <DialogHeader className="px-4 py-3 border-b border-border">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base">Media Gallery</DialogTitle>
            <div className="flex items-center gap-2">
              <Button
                variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={() => setViewMode('grid')}
              >
                <Grid3X3 className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={() => setViewMode('list')}
              >
                <List className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          
          {/* Filter tabs */}
          <div className="flex gap-1 mt-2 flex-wrap">
            {filterButtons.map(({ key, label, icon }) => (
              <Button
                key={key}
                variant={filter === key ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => setFilter(key)}
              >
                {icon}
                {label}
                <Badge 
                  variant="secondary" 
                  className={cn(
                    "ml-1 h-4 px-1 text-[10px]",
                    filter === key && "bg-primary-foreground/20"
                  )}
                >
                  {counts[key]}
                </Badge>
              </Button>
            ))}
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 p-4">
          {filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Image className="h-12 w-12 mb-2 opacity-50" />
              <p className="text-sm">No media found</p>
              <p className="text-xs">Media shared in this conversation will appear here</p>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {filteredItems.map(item => (
                <button
                  key={item.id}
                  className="aspect-square rounded-lg overflow-hidden border border-border hover:border-primary transition-colors cursor-pointer relative group"
                  onClick={() => onMediaClick(item.url, item.type, item.fileName)}
                >
                  {getMediaPreview(item)}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-[10px] text-white truncate">
                      {format(new Date(item.timestamp), 'MMM d, h:mm a')}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredItems.map(item => (
                <button
                  key={item.id}
                  className="w-full flex items-center gap-3 p-2 rounded-lg border border-border hover:border-primary hover:bg-secondary/50 transition-colors cursor-pointer text-left"
                  onClick={() => onMediaClick(item.url, item.type, item.fileName)}
                >
                  <div className="w-12 h-12 rounded overflow-hidden flex-shrink-0">
                    {getMediaPreview(item)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {item.fileName || 'Unnamed file'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(item.timestamp), 'MMM d, yyyy h:mm a')}
                    </p>
                  </div>
                  <Badge variant={item.sender === 'user' ? 'secondary' : 'outline'} className="text-[10px]">
                    {item.sender === 'user' ? 'Received' : 'Sent'}
                  </Badge>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
