import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Headset, TrendingUp, UserCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const TestAgentRouting = () => {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const { toast } = useToast();

  const testMessages = [
    { text: "My order is wrong, I'm very disappointed", expectedAgent: "support" },
    { text: "How much is your premium package?", expectedAgent: "sales" },
    { text: "I'd like to pay now, where do I send the money?", expectedAgent: "boss" },
    { text: "The service is broken and not working at all!", expectedAgent: "support" },
    { text: "What options do you have available?", expectedAgent: "sales" },
    { text: "I need to make a payment for my invoice", expectedAgent: "boss" }
  ];

  const testRouting = async (testMessage?: string) => {
    const messageToTest = testMessage || message;
    if (!messageToTest.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a message to test',
        variant: 'destructive'
      });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('test-agent-routing', {
        body: { 
          message: messageToTest,
          conversationHistory: []
        }
      });

      if (error) throw error;

      setResult(data);
      toast({
        title: 'Routing Complete',
        description: `Message routed to ${data.routing.agent} agent`
      });
    } catch (error: any) {
      console.error('Routing test error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to test routing',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const getAgentIcon = (agent: string) => {
    switch (agent) {
      case 'support': return <Headset className="h-4 w-4" />;
      case 'sales': return <TrendingUp className="h-4 w-4" />;
      case 'boss': return <UserCircle className="h-4 w-4" />;
      default: return null;
    }
  };

  const getAgentColor = (agent: string) => {
    switch (agent) {
      case 'support': return 'bg-green-50 text-green-700 border-green-200';
      case 'sales': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'boss': return 'bg-purple-50 text-purple-700 border-purple-200';
      default: return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle>Test Agent Routing System</CardTitle>
          <CardDescription>
            Test the multi-agent supervisor to see which agent (Support, Sales, or Boss) handles different message types
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Custom message test */}
          <div className="space-y-4">
            <h3 className="font-semibold">Test Custom Message</h3>
            <Textarea
              placeholder="Enter a customer message to test routing..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
            />
            <Button 
              onClick={() => testRouting()} 
              disabled={loading || !message.trim()}
              className="w-full"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Test Routing
            </Button>
          </div>

          {/* Pre-defined test cases */}
          <div className="space-y-4">
            <h3 className="font-semibold">Quick Test Cases</h3>
            <div className="grid gap-2">
              {testMessages.map((test, idx) => (
                <Button
                  key={idx}
                  variant="outline"
                  className="justify-start text-left h-auto py-3 px-4"
                  onClick={() => {
                    setMessage(test.text);
                    testRouting(test.text);
                  }}
                  disabled={loading}
                >
                  <div className="flex flex-col items-start gap-1 w-full">
                    <span className="text-sm">{test.text}</span>
                    <span className="text-xs text-muted-foreground">
                      Expected: {test.expectedAgent}
                    </span>
                  </div>
                </Button>
              ))}
            </div>
          </div>

          {/* Results */}
          {result && (
            <Card className="border-2">
              <CardHeader>
                <CardTitle className="text-lg">Routing Result</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Message:</p>
                  <p className="font-medium">{result.message}</p>
                </div>

                <div className="flex items-center gap-2">
                  <p className="text-sm text-muted-foreground">Routed to:</p>
                  <Badge 
                    variant="outline" 
                    className={`gap-2 ${getAgentColor(result.routing.agent)}`}
                  >
                    {getAgentIcon(result.routing.agent)}
                    <span className="font-semibold capitalize">{result.routing.agent} Agent</span>
                  </Badge>
                </div>

                <div>
                  <p className="text-sm text-muted-foreground mb-1">Reasoning:</p>
                  <p className="text-sm">{result.routing.reasoning}</p>
                </div>

                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Confidence:</p>
                    <p className="text-2xl font-bold">{(result.routing.confidence * 100).toFixed(0)}%</p>
                  </div>
                  <div className="flex-1">
                    <div className="w-full bg-secondary rounded-full h-2">
                      <div 
                        className="bg-primary h-2 rounded-full transition-all"
                        style={{ width: `${result.routing.confidence * 100}%` }}
                      />
                    </div>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  Tested at: {new Date(result.timestamp).toLocaleString()}
                </p>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default TestAgentRouting;
