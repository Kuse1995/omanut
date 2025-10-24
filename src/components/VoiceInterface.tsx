import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Mic, MicOff } from 'lucide-react';
import { RealtimeChat } from '@/utils/RealtimeAudio';

interface VoiceInterfaceProps {
  onSpeakingChange: (speaking: boolean) => void;
  onStatusChange: (status: string) => void;
  onMessage: (message: any) => void;
  companyId: string | null;
}

const VoiceInterface: React.FC<VoiceInterfaceProps> = ({ 
  onSpeakingChange, 
  onStatusChange,
  onMessage,
  companyId
}) => {
  const { toast } = useToast();
  const [isConnected, setIsConnected] = useState(false);
  const chatRef = useRef<RealtimeChat | null>(null);

  const handleMessage = (event: any) => {
    onMessage(event);
    
    if (event.type === 'response.audio.delta') {
      onSpeakingChange(true);
    } else if (event.type === 'response.audio.done') {
      onSpeakingChange(false);
    }
  };

  const startConversation = async () => {
    try {
      if (!companyId) {
        throw new Error('Company not found');
      }
      chatRef.current = new RealtimeChat(handleMessage, onStatusChange, companyId);
      await chatRef.current.init();
      setIsConnected(true);
      
      toast({
        title: "Connected",
        description: "Voice interface is ready",
      });
    } catch (error) {
      console.error('Error starting conversation:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : 'Failed to start conversation',
        variant: "destructive",
      });
    }
  };

  const endConversation = () => {
    chatRef.current?.disconnect();
    setIsConnected(false);
    onSpeakingChange(false);
    onStatusChange("Ready");
    
    toast({
      title: "Disconnected",
      description: "Voice session ended",
    });
  };

  useEffect(() => {
    return () => {
      chatRef.current?.disconnect();
    };
  }, []);

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-4 z-50">
      {!isConnected ? (
        <Button 
          onClick={startConversation}
          size="lg"
          className="rounded-full w-20 h-20 bg-primary hover:bg-primary/90 animate-pulse-glow shadow-lg"
        >
          <Mic className="h-10 w-10" />
        </Button>
      ) : (
        <Button 
          onClick={endConversation}
          size="lg"
          variant="secondary"
          className="rounded-full w-20 h-20 shadow-lg"
        >
          <MicOff className="h-10 w-10" />
        </Button>
      )}
    </div>
  );
};

export default VoiceInterface;