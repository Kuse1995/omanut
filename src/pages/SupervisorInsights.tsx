import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Brain, TrendingUp, Target, AlertTriangle, Lightbulb, MessageSquare, Send } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import ScheduledFollowUps from '@/components/ScheduledFollowUps';

interface SupervisorRecommendation {
  analysis: string;
  strategy: string;
  keyPoints: string[];
  toneGuidance: string;
  recommendedResponse: string;
  conversionTips: string[];
  avoidances: string[];
  researchUsed: boolean;
}

interface SupervisorInsight {
  id: string;
  created_at: string;
  message_from: string;
  message_content: string;
  response: string;
  recommendation?: SupervisorRecommendation;
  customerPhone?: string;
  customerMessage?: string;
}

export default function SupervisorInsights() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [insights, setInsights] = useState<SupervisorInsight[]>([]);
  const [selectedInsight, setSelectedInsight] = useState<SupervisorInsight | null>(null);

  useEffect(() => {
    checkAccess();
  }, []);

  const checkAccess = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      navigate('/login');
      return;
    }

    const { data: userRoles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', session.user.id)
      .single();

    if (!userRoles || (userRoles.role !== 'admin' && userRoles.role !== 'client')) {
      navigate('/');
      return;
    }

    const { data: user } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', session.user.id)
      .single();

    if (user?.company_id) {
      fetchInsights(user.company_id);
      setupRealtimeSubscription(user.company_id);
    }
  };

  const fetchInsights = async (companyId: string) => {
    setLoading(true);
    
    const { data, error } = await supabase
      .from('boss_conversations')
      .select('*')
      .eq('company_id', companyId)
      .eq('message_from', 'supervisor_agent')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Error fetching supervisor insights:', error);
    } else if (data) {
      const parsedInsights = data.map(insight => {
        try {
          const recommendation = JSON.parse(insight.response || '{}');
          const messageMatch = insight.message_content.match(/Analysis for (.+?): (.+)$/);
          
          return {
            ...insight,
            recommendation,
            customerPhone: messageMatch?.[1] || 'Unknown',
            customerMessage: messageMatch?.[2] || insight.message_content
          };
        } catch (e) {
          return insight;
        }
      });
      
      setInsights(parsedInsights);
      if (parsedInsights.length > 0 && !selectedInsight) {
        setSelectedInsight(parsedInsights[0]);
      }
    }
    
    setLoading(false);
  };

  const setupRealtimeSubscription = (companyId: string) => {
    const channel = supabase
      .channel('supervisor-insights')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'boss_conversations',
          filter: `company_id=eq.${companyId}`
        },
        (payload) => {
          if (payload.new.message_from === 'supervisor_agent') {
            try {
              const recommendation = JSON.parse((payload.new as any).response || '{}');
              const messageMatch = (payload.new as any).message_content.match(/Analysis for (.+?): (.+)$/);
              
              const newInsight: SupervisorInsight = {
                ...payload.new as any,
                recommendation,
                customerPhone: messageMatch?.[1] || 'Unknown',
                customerMessage: messageMatch?.[2] || (payload.new as any).message_content
              };
              
              setInsights(prev => [newInsight, ...prev]);
            } catch (e) {
              console.error('Error parsing new insight:', e);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const handleAnalyzeAndFollowup = async () => {
    setAnalyzing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: user } = await supabase
        .from('users')
        .select('company_id')
        .eq('id', session.user.id)
        .single();

      if (!user?.company_id) return;

      const { data, error } = await supabase.functions.invoke('analyze-and-followup', {
        body: { companyId: user.company_id }
      });

      if (error) throw error;

      toast({
        title: "Follow-ups Sent",
        description: `Analyzed and sent ${data.processed} strategic follow-up messages to customers.`,
      });
    } catch (error) {
      console.error('Error analyzing and following up:', error);
      toast({
        title: "Error",
        description: "Failed to analyze conversations and send follow-ups.",
        variant: "destructive",
      });
    } finally {
      setAnalyzing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          <Skeleton className="h-10 w-64" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Skeleton className="h-[600px]" />
            <Skeleton className="h-[600px] lg:col-span-2" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card/50 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-4">
          <BackButton />
          <div className="flex items-center gap-3">
            <Brain className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Supervisor Insights</h1>
          </div>
          <Badge variant="secondary" className="ml-auto">
            {insights.length} Analyses
          </Badge>
          <Button 
            onClick={handleAnalyzeAndFollowup}
            disabled={analyzing}
            className="gap-2"
          >
            <Send className="h-4 w-4" />
            {analyzing ? 'Analyzing...' : 'Analyze & Follow Up'}
          </Button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <ScheduledFollowUps />
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Insights List */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Analyses</CardTitle>
              <CardDescription>Latest supervisor recommendations</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[600px]">
                {insights.map((insight) => (
                  <button
                    key={insight.id}
                    onClick={() => setSelectedInsight(insight)}
                    className={`w-full text-left p-4 border-b hover:bg-muted/50 transition-colors ${
                      selectedInsight?.id === insight.id ? 'bg-muted' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{insight.customerPhone}</p>
                        <p className="text-sm text-muted-foreground truncate mt-1">
                          {insight.customerMessage}
                        </p>
                      </div>
                      {insight.recommendation?.researchUsed && (
                        <Badge variant="outline" className="shrink-0">
                          <Lightbulb className="h-3 w-3 mr-1" />
                          Research
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {new Date(insight.created_at).toLocaleString()}
                    </p>
                  </button>
                ))}
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Detailed View */}
          {insights.length === 0 ? (
            <div className="lg:col-span-2 flex flex-col items-center justify-center h-[600px] text-center px-6">
              <Brain className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Supervisor Insights Yet</h3>
              <p className="text-muted-foreground max-w-md">
                The Supervisor Agent will analyze customer conversations and provide strategic recommendations in real-time. 
                Insights will appear here once customers start messaging your WhatsApp number.
              </p>
            </div>
          ) : selectedInsight?.recommendation ? (
            <ScrollArea className="lg:col-span-2 h-[calc(100vh-200px)]">
              <div className="space-y-4 pr-4">
                {/* Customer Message Section */}
                <Card className="border-accent-blue/30">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <MessageSquare className="h-5 w-5 text-accent-blue" />
                      Customer Message
                    </CardTitle>
                    <CardDescription>Original inquiry from {selectedInsight.customerPhone}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-accent-blue/5 border border-accent-blue/20 rounded-lg p-4">
                      <p className="text-foreground whitespace-pre-wrap">{selectedInsight.customerMessage}</p>
                    </div>
                  </CardContent>
                </Card>

                {/* Supervisor Reasoning Flow */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="h-px flex-1 bg-border"></div>
                    <span className="flex items-center gap-2">
                      <Brain className="h-4 w-4 text-accent-purple" />
                      Supervisor AI Reasoning Process
                    </span>
                    <div className="h-px flex-1 bg-border"></div>
                  </div>

                  {/* Analysis Card */}
                  <Card className="border-accent-purple/30">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Brain className="h-5 w-5 text-accent-purple" />
                        Strategic Analysis
                      </CardTitle>
                      <CardDescription>Supervisor's understanding of the situation</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="bg-accent-purple/5 border border-accent-purple/20 rounded-lg p-4">
                        <p className="text-foreground whitespace-pre-wrap">{selectedInsight.recommendation.analysis}</p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Strategy Card */}
                  <Card className="border-accent-green/30">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Target className="h-5 w-5 text-accent-green" />
                        Recommended Strategy
                      </CardTitle>
                      <CardDescription>How to approach this conversation</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="bg-accent-green/5 border border-accent-green/20 rounded-lg p-4">
                        <p className="text-foreground">{selectedInsight.recommendation.strategy}</p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Key Points & Tone Grid */}
                  <div className="grid md:grid-cols-2 gap-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <Lightbulb className="h-4 w-4 text-accent-yellow" />
                          Key Points to Address
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-2">
                          {selectedInsight.recommendation.keyPoints.map((point, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                              <span className="text-accent-yellow mt-1">•</span>
                              <span className="text-sm">{point}</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <MessageSquare className="h-4 w-4 text-accent-purple" />
                          Tone Guidance
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="bg-muted/50 rounded-lg p-3">
                          <p className="text-sm">{selectedInsight.recommendation.toneGuidance}</p>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Recommended Response */}
                  <Card className="border-accent-orange/30">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Send className="h-5 w-5 text-accent-orange" />
                        Recommended Response
                      </CardTitle>
                      <CardDescription>Supervisor's suggested message for main AI to deliver</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="bg-accent-orange/5 border border-accent-orange/20 rounded-lg p-4">
                        <p className="text-foreground whitespace-pre-wrap">{selectedInsight.recommendation.recommendedResponse}</p>
                      </div>
                      <div className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
                        <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                        <span>This is guidance for the main AI. The actual response may be adapted based on conversation context.</span>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Tips & Avoidances Grid */}
                  <div className="grid md:grid-cols-2 gap-4">
                    <Card className="border-accent-green/30">
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <TrendingUp className="h-4 w-4 text-accent-green" />
                          Conversion Tips
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-2">
                          {selectedInsight.recommendation.conversionTips.map((tip, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                              <span className="text-accent-green mt-1">✓</span>
                              <span className="text-sm">{tip}</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>

                    <Card className="border-destructive/30">
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-destructive" />
                          Things to Avoid
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-2">
                          {selectedInsight.recommendation.avoidances.map((avoid, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                              <span className="text-destructive mt-1">✗</span>
                              <span className="text-sm">{avoid}</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Research Badge */}
                  {selectedInsight.recommendation.researchUsed && (
                    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                      <Badge variant="secondary" className="bg-accent-blue/10">
                        <Brain className="h-3 w-3 mr-1" />
                        Market research performed
                      </Badge>
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>
          ) : (
            <div className="lg:col-span-2 flex items-center justify-center h-[600px]">
              <p className="text-muted-foreground">Select an insight to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
