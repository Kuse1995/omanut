import { Brain, TrendingUp, AlertTriangle, Smile, Meh, Frown, Zap, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { LiveInsight } from '@/hooks/useLiveSupervisorAnalysis';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface LiveInsightsBarProps {
  insight: LiveInsight | null;
  isAnalyzing: boolean;
}

export function LiveInsightsBar({ insight, isAnalyzing }: LiveInsightsBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!insight && !isAnalyzing) {
    return null;
  }

  const getSentimentIcon = () => {
    if (!insight) return <Meh className="h-4 w-4" />;
    switch (insight.sentiment) {
      case 'positive':
        return <Smile className="h-4 w-4 text-emerald-500" />;
      case 'negative':
        return <Frown className="h-4 w-4 text-destructive" />;
      default:
        return <Meh className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getUrgencyColor = () => {
    if (!insight) return 'bg-muted';
    switch (insight.urgency) {
      case 'high':
        return 'bg-destructive text-destructive-foreground';
      case 'medium':
        return 'bg-amber-500 text-white';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const getConversionColor = () => {
    if (!insight) return 'text-muted-foreground';
    if (insight.conversionProbability >= 70) return 'text-emerald-500';
    if (insight.conversionProbability >= 40) return 'text-amber-500';
    return 'text-muted-foreground';
  };

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className="border-b border-border bg-gradient-to-r from-accent/5 to-primary/5">
        {/* Compact Bar */}
        <div className="px-4 py-2">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {isAnalyzing ? (
                  <Loader2 className="h-4 w-4 text-primary animate-spin" />
                ) : (
                  <Brain className="h-4 w-4 text-primary" />
                )}
                <span className="text-xs font-medium text-muted-foreground">
                  {isAnalyzing ? 'Analyzing...' : 'Live Insights'}
                </span>
              </div>

              {insight && !isAnalyzing && (
                <>
                  <div className="h-4 w-px bg-border" />
                  
                  {/* Sentiment */}
                  <div className="flex items-center gap-1">
                    {getSentimentIcon()}
                    <span className="text-xs capitalize">{insight.sentiment}</span>
                  </div>

                  <div className="h-4 w-px bg-border" />

                  {/* Urgency */}
                  <Badge variant="secondary" className={cn("h-5 text-[10px]", getUrgencyColor())}>
                    {insight.urgency === 'high' && <AlertTriangle className="h-3 w-3 mr-1" />}
                    {insight.urgency.toUpperCase()}
                  </Badge>

                  <div className="h-4 w-px bg-border" />

                  {/* Conversion */}
                  <div className="flex items-center gap-2">
                    <TrendingUp className={cn("h-4 w-4", getConversionColor())} />
                    <span className={cn("text-xs font-medium", getConversionColor())}>
                      {insight.conversionProbability}%
                    </span>
                    <Progress 
                      value={insight.conversionProbability} 
                      className="w-16 h-1.5"
                    />
                  </div>

                  {/* Quick Strategy Preview */}
                  <div className="hidden lg:flex items-center gap-2 min-w-0 flex-1">
                    <div className="h-4 w-px bg-border" />
                    <Zap className="h-3 w-3 text-amber-500 shrink-0" />
                    <span className="text-xs text-muted-foreground truncate">
                      {insight.strategy}
                    </span>
                  </div>
                </>
              )}
            </div>

            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 px-2">
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>

        {/* Expanded Details */}
        <CollapsibleContent>
          {insight && (
            <div className="px-4 pb-3 space-y-3 border-t border-border/50 pt-3">
              {/* Analysis */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Brain className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-semibold">Analysis</span>
                </div>
                <p className="text-xs text-muted-foreground ml-5">
                  {insight.analysis}
                </p>
              </div>

              {/* Key Signals */}
              {insight.keySignals.length > 0 && (
                <div>
                  <span className="text-xs font-semibold">Key Signals:</span>
                  <div className="flex flex-wrap gap-1 mt-1 ml-5">
                    {insight.keySignals.slice(0, 4).map((signal, idx) => (
                      <Badge key={idx} variant="outline" className="text-[10px] h-5">
                        {signal.length > 30 ? signal.substring(0, 30) + '...' : signal}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggested Action */}
              <div className="bg-primary/5 rounded-md p-2 border border-primary/20">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-xs font-semibold">Suggested Response</span>
                </div>
                <p className="text-xs ml-5">
                  {insight.suggestedAction}...
                </p>
              </div>
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
