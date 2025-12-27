import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface LiveInsight {
  id: string;
  timestamp: string;
  analysis: string;
  strategy: string;
  urgency: 'low' | 'medium' | 'high';
  sentiment: 'positive' | 'neutral' | 'negative';
  conversionProbability: number;
  keySignals: string[];
  suggestedAction: string;
  isAnalyzing: boolean;
}

export function useLiveSupervisorAnalysis(
  conversationId: string,
  companyId: string | null,
  messages: { id: string; content: string; role: string; created_at: string }[]
) {
  const [liveInsight, setLiveInsight] = useState<LiveInsight | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastAnalyzedMessageId, setLastAnalyzedMessageId] = useState<string | null>(null);

  const analyzeLatestMessage = useCallback(async () => {
    if (!companyId || messages.length === 0) return;

    const latestUserMessage = [...messages]
      .reverse()
      .find(m => m.role === 'user');

    if (!latestUserMessage || latestUserMessage.id === lastAnalyzedMessageId) {
      return;
    }

    setIsAnalyzing(true);
    setLastAnalyzedMessageId(latestUserMessage.id);

    try {
      const { data, error } = await supabase.functions.invoke('supervisor-agent', {
        body: {
          companyId,
          conversationId,
          customerMessage: latestUserMessage.content,
          conversationHistory: messages.slice(-10).map(m => ({
            role: m.role,
            content: m.content
          })),
          realTimeAnalysis: true
        }
      });

      if (error) {
        console.error('Supervisor analysis error:', error);
        return;
      }

      if (data?.recommendation) {
        const rec = data.recommendation;
        
        // Determine urgency based on content
        let urgency: 'low' | 'medium' | 'high' = 'low';
        const content = latestUserMessage.content.toLowerCase();
        if (content.includes('urgent') || content.includes('asap') || content.includes('complaint')) {
          urgency = 'high';
        } else if (content.includes('help') || content.includes('problem') || content.includes('issue')) {
          urgency = 'medium';
        }

        // Determine sentiment
        let sentiment: 'positive' | 'neutral' | 'negative' = 'neutral';
        if (content.includes('thank') || content.includes('great') || content.includes('love')) {
          sentiment = 'positive';
        } else if (content.includes('bad') || content.includes('worst') || content.includes('hate')) {
          sentiment = 'negative';
        }

        // Extract conversion probability from analysis
        const conversionProbability = rec.conversionTips?.length > 2 ? 75 : 
          rec.conversionTips?.length > 0 ? 50 : 25;

        setLiveInsight({
          id: latestUserMessage.id,
          timestamp: new Date().toISOString(),
          analysis: rec.analysis || 'Analyzing customer intent...',
          strategy: rec.strategy || 'Standard engagement',
          urgency,
          sentiment,
          conversionProbability,
          keySignals: rec.keyPoints || [],
          suggestedAction: rec.recommendedResponse?.substring(0, 150) || 'Continue conversation naturally',
          isAnalyzing: false
        });
      }
    } catch (err) {
      console.error('Failed to analyze:', err);
    } finally {
      setIsAnalyzing(false);
    }
  }, [companyId, conversationId, messages, lastAnalyzedMessageId]);

  // Trigger analysis when new user messages arrive
  useEffect(() => {
    const latestMessage = messages[messages.length - 1];
    if (latestMessage?.role === 'user' && latestMessage.id !== lastAnalyzedMessageId) {
      // Debounce to avoid too frequent calls
      const timer = setTimeout(() => {
        analyzeLatestMessage();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [messages, lastAnalyzedMessageId, analyzeLatestMessage]);

  // Listen for real-time supervisor updates
  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`live-supervisor-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'boss_conversations',
          filter: `message_from=eq.supervisor_agent`
        },
        (payload) => {
          try {
            const rec = JSON.parse((payload.new as any).response || '{}');
            if (rec && (payload.new as any).message_content?.includes(conversationId)) {
              setLiveInsight(prev => ({
                ...prev!,
                analysis: rec.analysis,
                strategy: rec.strategy,
                keySignals: rec.keyPoints || [],
                suggestedAction: rec.recommendedResponse?.substring(0, 150),
                isAnalyzing: false
              }));
            }
          } catch (e) {
            console.error('Failed to parse supervisor update:', e);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  return {
    liveInsight,
    isAnalyzing,
    triggerAnalysis: analyzeLatestMessage
  };
}
