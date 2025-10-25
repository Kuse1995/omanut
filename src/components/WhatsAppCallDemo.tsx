import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Phone, PhoneOff, MessageSquare } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface WhatsAppCallDemoProps {
  companyId: string;
  whatsappNumber?: string;
}

const WhatsAppCallDemo = ({ companyId, whatsappNumber }: WhatsAppCallDemoProps) => {
  const [isCallActive, setIsCallActive] = useState(false);
  const [callStatus, setCallStatus] = useState('Ready to call');
  const { toast } = useToast();

  const startCall = () => {
    if (!whatsappNumber) {
      toast({
        title: 'WhatsApp Not Configured',
        description: 'Please configure your WhatsApp number in settings first.',
        variant: 'destructive',
      });
      return;
    }

    setIsCallActive(true);
    setCallStatus('Simulating call...');
    
    setTimeout(() => {
      setCallStatus('Call connected');
      toast({
        title: 'Demo Mode',
        description: 'This is a simulation. To test live, call your WhatsApp number from your phone using WhatsApp.',
      });
    }, 1500);
  };

  const endCall = () => {
    setIsCallActive(false);
    setCallStatus('Call ended');
    setTimeout(() => setCallStatus('Ready to call'), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-green-500" />
          WhatsApp Voice Call Test
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="text-center space-y-4">
          <Badge variant={isCallActive ? 'default' : 'secondary'} className="text-sm">
            {callStatus}
          </Badge>
          
          {whatsappNumber && (
            <div className="text-sm text-muted-foreground">
              <p>WhatsApp Number: <span className="font-mono">{whatsappNumber}</span></p>
            </div>
          )}

          <div className="py-8">
            {!isCallActive ? (
              <Button
                size="lg"
                onClick={startCall}
                className="w-32 h-32 rounded-full"
              >
                <Phone className="h-8 w-8" />
              </Button>
            ) : (
              <Button
                size="lg"
                variant="destructive"
                onClick={endCall}
                className="w-32 h-32 rounded-full"
              >
                <PhoneOff className="h-8 w-8" />
              </Button>
            )}
          </div>

          <div className="text-xs text-muted-foreground space-y-2">
            <p className="font-semibold">To test live WhatsApp calls:</p>
            <ol className="text-left list-decimal list-inside space-y-1">
              <li>Open WhatsApp on your phone</li>
              <li>Call your configured WhatsApp Business number</li>
              <li>The AI receptionist will answer automatically</li>
            </ol>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default WhatsAppCallDemo;