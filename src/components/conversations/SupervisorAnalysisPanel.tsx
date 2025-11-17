import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Brain, Target, Lightbulb, TrendingUp, AlertTriangle } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

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

interface SupervisorAnalysisPanelProps {
  conversationId: string;
  customerPhone: string;
}

export default function SupervisorAnalysisPanel({ conversationId, customerPhone }: SupervisorAnalysisPanelProps) {
  const [analyses, setAnalyses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalyses();
    setupRealtimeSubscription();
  }, [conversationId, customerPhone]);

  const fetchAnalyses = async () => {
    setLoading(true);
    
    // Fetch supervisor analyses for this conversation/customer
    const { data, error } = await supabase
      .from('boss_conversations')
      .select('*')
      .eq('message_from', 'supervisor_agent')
      .ilike('message_content', `%${customerPhone}%`)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('Error fetching supervisor analyses:', error);
    } else if (data) {
      const parsedAnalyses = data.map(analysis => {
        try {
          const recommendation = JSON.parse(analysis.response || '{}');
          return { ...analysis, recommendation };
        } catch (e) {
          return { ...analysis, recommendation: null };
        }
      });
      setAnalyses(parsedAnalyses);
    }
    
    setLoading(false);
  };

  const setupRealtimeSubscription = () => {
    const channel = supabase
      .channel(`supervisor-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'boss_conversations',
          filter: `message_from=eq.supervisor_agent`
        },
        (payload) => {
          if (payload.new.message_content.includes(customerPhone)) {
            try {
              const recommendation = JSON.parse((payload.new as any).response || '{}');
              setAnalyses(prev => [{ ...payload.new, recommendation }, ...prev]);
            } catch (e) {
              setAnalyses(prev => [{ ...payload.new, recommendation: null }, ...prev]);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  if (loading) {
    return (
      <Card className="card-glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-accent-purple" />
            Supervisor AI Analysis
          </CardTitle>
          <CardDescription>Loading strategic insights...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (analyses.length === 0) {
    return (
      <Card className="card-glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-accent-purple" />
            Supervisor AI Analysis
          </CardTitle>
          <CardDescription>No supervisor analysis available yet</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The supervisor will analyze customer messages and provide strategic recommendations to guide the main AI's responses.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="card-glass">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-accent-purple" />
          Supervisor AI Analysis
        </CardTitle>
        <CardDescription>{analyses.length} strategic analyses</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[600px] pr-4">
          <div className="space-y-4">
            {analyses.map((analysis) => {
              const rec = analysis.recommendation as SupervisorRecommendation | null;
              
              if (!rec) {
                return (
                  <div key={analysis.id} className="p-4 border border-border rounded-lg bg-background/50">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                      <span className="text-sm text-muted-foreground">
                        {new Date(analysis.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">Analysis failed or incomplete</p>
                  </div>
                );
              }

              return (
                <div key={analysis.id} className="p-4 border border-border rounded-lg bg-background/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {new Date(analysis.created_at).toLocaleString()}
                    </span>
                    {rec.researchUsed && (
                      <Badge variant="outline" className="text-xs">
                        <TrendingUp className="h-3 w-3 mr-1" />
                        Web Research Used
                      </Badge>
                    )}
                  </div>

                  <Separator />

                  {/* Customer Message Being Analyzed */}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Target className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">Customer Message</span>
                    </div>
                    <p className="text-sm text-muted-foreground ml-6">
                      {analysis.message_content.split(': ')[1] || analysis.message_content}
                    </p>
                  </div>

                  {/* Supervisor's Analysis */}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Brain className="h-4 w-4 text-accent-purple" />
                      <span className="text-sm font-medium">Strategic Analysis</span>
                    </div>
                    <p className="text-sm ml-6">{rec.analysis}</p>
                  </div>

                  {/* Strategy */}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Lightbulb className="h-4 w-4 text-accent-gold" />
                      <span className="text-sm font-medium">Strategy</span>
                    </div>
                    <p className="text-sm ml-6">{rec.strategy}</p>
                  </div>

                  {/* Key Points */}
                  {rec.keyPoints && rec.keyPoints.length > 0 && (
                    <div>
                      <span className="text-sm font-medium">Key Points:</span>
                      <ul className="text-sm ml-6 mt-1 space-y-1">
                        {rec.keyPoints.map((point, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-primary">•</span>
                            <span>{point}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Tone Guidance */}
                  <div>
                    <span className="text-sm font-medium">Tone:</span>
                    <span className="text-sm ml-2 text-muted-foreground">{rec.toneGuidance}</span>
                  </div>

                  {/* Recommended Response */}
                  <div className="bg-primary/5 p-3 rounded-md border border-primary/20">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-semibold text-primary">Supervisor's Recommended Response:</span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{rec.recommendedResponse}</p>
                  </div>

                  {/* Conversion Tips */}
                  {rec.conversionTips && rec.conversionTips.length > 0 && (
                    <div>
                      <span className="text-sm font-medium text-accent-lime">Conversion Tips:</span>
                      <ul className="text-sm ml-6 mt-1 space-y-1">
                        {rec.conversionTips.map((tip, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-accent-lime">✓</span>
                            <span>{tip}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Avoidances */}
                  {rec.avoidances && rec.avoidances.length > 0 && (
                    <div>
                      <span className="text-sm font-medium text-destructive">Avoid:</span>
                      <ul className="text-sm ml-6 mt-1 space-y-1">
                        {rec.avoidances.map((avoid, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-destructive">✗</span>
                            <span>{avoid}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
