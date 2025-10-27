import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import VoiceInterface from '@/components/VoiceInterface';
import AudioVisualizer from '@/components/AudioVisualizer';
import BackButton from '@/components/BackButton';
import ChatDemo from '@/components/ChatDemo';
import WhatsAppCallDemo from '@/components/WhatsAppCallDemo';
import ThemeToggle from '@/components/ThemeToggle';

const LiveDemo = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [events, setEvents] = useState<string[]>([]);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [whatsappNumber, setWhatsappNumber] = useState<string | null>(null);

  useEffect(() => {
    checkAccess();
  }, [navigate]);

  const checkAccess = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        navigate('/login');
        return;
      }

      // Check if user has admin role (admins can test)
      const { data: isAdmin } = await supabase.rpc('has_role', {
        _user_id: session.user.id,
        _role: 'admin'
      });

      // Check if user has client role (clients can test their own AI)
      const { data: isClient } = await supabase.rpc('has_role', {
        _user_id: session.user.id,
        _role: 'client'
      });

      if (!isAdmin && !isClient) {
        navigate('/');
        return;
      }

      // Get user's company_id
      const { data: userData } = await supabase
        .from('users')
        .select('company_id')
        .eq('id', session.user.id)
        .single();

      if (userData?.company_id) {
        setCompanyId(userData.company_id);
        
        // Get company WhatsApp number
        const { data: companyData } = await supabase
          .from('companies')
          .select('whatsapp_number')
          .eq('id', userData.company_id)
          .single();
        
        if (companyData?.whatsapp_number) {
          setWhatsappNumber(companyData.whatsapp_number);
        }
      }

      setIsLoading(false);
    } catch (error) {
      console.error('Error checking access:', error);
      navigate('/login');
    }
  };

  const handleMessage = (event: any) => {
    try {
      const timestamp = new Date().toLocaleTimeString();
      setEvents(prev => [`[${timestamp}] ${event.type}`, ...prev].slice(0, 50));
    } catch (error) {
      console.error('Error handling message:', error);
    }
  };

  const getStatusVariant = () => {
    if (status === 'Ready') return 'default';
    if (status === 'Connecting…') return 'secondary';
    if (status === 'Talking to Guest') return 'default';
    if (status.includes('Bad Network')) return 'destructive';
    return 'secondary';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
          <p className="text-muted-foreground">Verifying access...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between mb-6">
        <BackButton />
        <ThemeToggle />
      </div>
      <div>
        <h1 className="text-3xl font-bold mb-2">AI Assistant Demo</h1>
        <p className="text-muted-foreground">Test all channels: Voice, Chat, and WhatsApp</p>
      </div>

      <Tabs defaultValue="voice" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="voice">Voice Call</TabsTrigger>
          <TabsTrigger value="chat">WhatsApp Chat</TabsTrigger>
          <TabsTrigger value="whatsapp-call">WhatsApp Call</TabsTrigger>
        </TabsList>

        <TabsContent value="voice" className="space-y-6">
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
                    <h3 className="text-lg font-semibold text-foreground">Voice Interface</h3>
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
                <h3 className="text-lg font-semibold mb-4 text-foreground">Event Log</h3>
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
            companyId={companyId}
          />
        </TabsContent>

        <TabsContent value="chat" className="space-y-6">
          <div className="max-w-2xl mx-auto">
            <div className="mb-4">
              <h3 className="text-lg font-semibold mb-2">WhatsApp Chat Demo</h3>
              <p className="text-sm text-muted-foreground">
                Test how your AI responds to text messages. To test live, send a WhatsApp message to your configured number.
              </p>
            </div>
            {companyId && <ChatDemo companyId={companyId} />}
          </div>
        </TabsContent>

        <TabsContent value="whatsapp-call" className="space-y-6">
          <div className="max-w-2xl mx-auto">
            {companyId && (
              <WhatsAppCallDemo 
                companyId={companyId} 
                whatsappNumber={whatsappNumber || undefined}
              />
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default LiveDemo;