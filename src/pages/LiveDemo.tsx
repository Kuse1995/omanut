import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import VoiceInterface from '@/components/VoiceInterface';
import AudioVisualizer from '@/components/AudioVisualizer';

const LiveDemo = () => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [events, setEvents] = useState<string[]>([]);

  const handleMessage = (event: any) => {
    const timestamp = new Date().toLocaleTimeString();
    setEvents(prev => [`[${timestamp}] ${event.type}`, ...prev].slice(0, 50));
  };

  const getStatusVariant = () => {
    if (status === 'Ready') return 'default';
    if (status === 'Connecting…') return 'secondary';
    if (status === 'Talking to Guest') return 'default';
    if (status.includes('Bad Network')) return 'destructive';
    return 'secondary';
  };

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">AI Voice Assistant Demo</h1>
        <p className="text-muted-foreground">Test the voice agent right here</p>
      </div>

      <div className="flex items-center gap-4">
        <Badge variant={getStatusVariant() as any} className="text-sm px-4 py-2">
          {status}
        </Badge>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="bg-card">
          <CardContent className="pt-6">
            <div className="text-center space-y-6">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Voice Interface</h3>
                <p className="text-sm text-muted-foreground">
                  Click the microphone to start speaking
                </p>
              </div>
              
              <div className="flex justify-center py-8">
                <AudioVisualizer isActive={isSpeaking} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardContent className="pt-6">
            <h3 className="text-lg font-semibold mb-4">Event Log</h3>
            <ScrollArea className="h-[300px]">
              <div className="space-y-2 pr-4">
                {events.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">
                    Waiting for events...
                  </p>
                ) : (
                  events.map((event, i) => (
                    <div 
                      key={i} 
                      className="text-xs font-mono p-2 bg-muted/50 rounded"
                    >
                      {event}
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <VoiceInterface 
        onSpeakingChange={setIsSpeaking}
        onStatusChange={setStatus}
        onMessage={handleMessage}
      />
    </div>
  );
};

export default LiveDemo;