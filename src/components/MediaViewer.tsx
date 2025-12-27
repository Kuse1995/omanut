import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, Download } from "lucide-react";

interface MediaViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mediaUrl: string;
  mediaType: string;
  fileName?: string;
}

export const MediaViewer = ({ 
  open, 
  onOpenChange, 
  mediaUrl, 
  mediaType,
  fileName 
}: MediaViewerProps) => {
  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = mediaUrl;
    link.download = fileName || 'media-file';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const renderMedia = () => {
    // Normalize media type check
    const isImage = mediaType.startsWith('image') || mediaType === 'image';
    const isVideo = mediaType.startsWith('video') || mediaType === 'video';
    const isAudio = mediaType.startsWith('audio') || mediaType === 'audio';
    const isPdf = mediaType === 'application/pdf' || mediaType === 'pdf';

    if (isImage) {
      return (
        <img 
          src={mediaUrl} 
          alt="Media content" 
          className="max-h-[80vh] max-w-full object-contain"
        />
      );
    }
    
    if (isVideo) {
      return (
        <video 
          controls 
          autoPlay
          className="max-h-[80vh] max-w-full"
          src={mediaUrl}
        />
      );
    }
    
    if (isAudio) {
      return (
        <div className="flex flex-col items-center gap-4 p-8">
          <audio controls autoPlay className="w-full max-w-md">
            <source src={mediaUrl} type={mediaType} />
          </audio>
          <Button onClick={handleDownload} variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Download Audio
          </Button>
        </div>
      );
    }

    if (isPdf) {
      return (
        <div className="flex flex-col items-center gap-4 p-8 w-full h-[80vh]">
          <iframe 
            src={mediaUrl} 
            className="w-full h-full rounded-lg border border-border"
            title="PDF Viewer"
          />
          <Button onClick={handleDownload} variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Download PDF
          </Button>
        </div>
      );
    }
    
    return (
      <div className="flex flex-col items-center gap-4 p-8">
        <p className="text-muted-foreground">Preview not available</p>
        <Button onClick={handleDownload} variant="outline">
          <Download className="h-4 w-4 mr-2" />
          Download File
        </Button>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden bg-background/95 backdrop-blur">
        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 z-10 bg-background/80 hover:bg-background"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
          {(mediaType.startsWith('image') || mediaType === 'image') && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-14 z-10 bg-background/80 hover:bg-background"
              onClick={handleDownload}
            >
              <Download className="h-4 w-4" />
            </Button>
          )}
          <div className="flex items-center justify-center min-h-[200px]">
            {renderMedia()}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
