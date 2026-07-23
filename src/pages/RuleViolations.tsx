import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCompany } from '@/context/CompanyContext';
import ClientLayout from '@/components/dashboard/ClientLayout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

type Violation = {
  id: string;
  conversation_id: string | null;
  channel: string;
  severity: 'low' | 'medium' | 'high';
  rule_broken: string;
  explanation: string | null;
  offending_excerpt: string | null;
  assistant_content: string | null;
  reviewed: boolean;
  created_at: string;
};

export default function RuleViolations() {
  const { activeCompanyId } = useCompany();
  const [items, setItems] = useState<Violation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'open' | 'all'>('open');

  const load = async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    let q = supabase
      .from('rule_violations')
      .select('*')
      .eq('company_id', activeCompanyId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (filter === 'open') q = q.eq('reviewed', false);
    const { data, error } = await q;
    if (error) toast({ title: 'Failed to load', description: error.message, variant: 'destructive' });
    setItems((data as Violation[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeCompanyId, filter]);

  const markReviewed = async (id: string) => {
    const { error } = await supabase.from('rule_violations').update({ reviewed: true }).eq('id', id);
    if (error) return toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
    setItems((prev) => prev.filter((v) => v.id !== id));
  };

  const sevColor = (s: string) =>
    s === 'high' ? 'bg-red-500/15 text-red-600 border-red-500/30'
      : s === 'medium' ? 'bg-amber-500/15 text-amber-600 border-amber-500/30'
        : 'bg-muted text-muted-foreground';

  return (
    <ClientLayout>
      <div className="p-4 md:p-8 space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <AlertTriangle className="w-6 h-6 text-amber-500" />
              Rule Violations
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Every AI reply is audited against your custom instructions and banned topics. Drift is logged here.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant={filter === 'open' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('open')}>
              Open
            </Button>
            <Button variant={filter === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('all')}>
              All
            </Button>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {loading && items.length === 0 && (
          <div className="text-sm text-muted-foreground">Loading…</div>
        )}

        {!loading && items.length === 0 && (
          <Card className="p-8 text-center space-y-2">
            <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500" />
            <div className="font-medium">No {filter === 'open' ? 'open ' : ''}violations</div>
            <p className="text-sm text-muted-foreground">
              The AI is following your custom instructions.
            </p>
          </Card>
        )}

        <div className="space-y-3">
          {items.map((v) => (
            <Card key={v.id} className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={sevColor(v.severity)}>{v.severity.toUpperCase()}</Badge>
                    <Badge variant="outline">{v.channel}</Badge>
                    <span className="font-medium">{v.rule_broken}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(v.created_at), { addSuffix: true })}
                  </div>
                </div>
                {!v.reviewed && (
                  <Button size="sm" variant="outline" onClick={() => markReviewed(v.id)}>
                    Mark reviewed
                  </Button>
                )}
              </div>

              {v.explanation && (
                <p className="text-sm">{v.explanation}</p>
              )}

              {v.offending_excerpt && (
                <div className="text-xs bg-red-500/5 border border-red-500/20 rounded p-2">
                  <div className="font-medium mb-1 text-red-600">Offending excerpt</div>
                  <div className="italic">"{v.offending_excerpt}"</div>
                </div>
              )}

              {v.assistant_content && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    Full AI reply
                  </summary>
                  <div className="mt-2 p-2 rounded bg-muted whitespace-pre-wrap">{v.assistant_content}</div>
                </details>
              )}

              {v.conversation_id && (
                <a
                  href={`/conversations?id=${v.conversation_id}`}
                  className="text-xs text-primary hover:underline inline-block"
                >
                  Open conversation →
                </a>
              )}
            </Card>
          ))}
        </div>
      </div>
    </ClientLayout>
  );
}
