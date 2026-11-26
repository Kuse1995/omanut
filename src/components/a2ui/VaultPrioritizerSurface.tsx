import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { ArrowUp, ArrowDown, Send, Sparkles, CheckCircle2, Loader2 } from 'lucide-react';
import type { CallA2UIFn, StudioTab, VaultAsset } from './types';

interface VaultPrioritizerSurfaceProps {
  vault: VaultAsset[];
  suggestedNote?: string | null;
  callA2UI: CallA2UIFn;
  onRefresh: () => Promise<void>;
  onSwitchTab: (tab: StudioTab) => void;
}

export function VaultPrioritizerSurface({
  vault,
  suggestedNote,
  callA2UI,
  onRefresh,
  onSwitchTab,
}: VaultPrioritizerSurfaceProps) {
  const candidates = vault.filter((v) => v.vault_status === 'ready' || v.vault_status === 'evergreen' || v.vault_status === 'raw');
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    candidates.filter((c) => typeof c.priority_rank === 'number').slice(0, 5).map((c) => c.id)
  );
  const [note, setNote] = useState(suggestedNote || '');
  const [submitting, setSubmitting] = useState(false);
  const [submittedOk, setSubmittedOk] = useState(false);

  const togglePick = (id: string) => {
    setSubmittedOk(false);
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(0, 6)));
  };

  const moveItem = (index: number, delta: -1 | 1) => {
    setSelectedIds((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selectedIds.length === 0) {
      toast.error('Tap at least 1 item to rank it #1.');
      return;
    }
    setSubmitting(true);
    try {
      await callA2UI('submit_vault_ranking', {
        ranked_asset_ids: selectedIds,
        note,
      });
      setSubmittedOk(true);
      toast.success('Order sent! Check WhatsApp — your Marketer is drafting those posts now.');
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send order');
    } finally {
      setSubmitting(false);
    }
  };

  if (candidates.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            Your Vault has no unposted photos or videos yet. Upload a few first so we can decide which goes first!
          </p>
          <Button onClick={() => onSwitchTab('vault')}>Go to Vault Uploader</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {submittedOk && (
        <Card className="border-emerald-500/40 bg-emerald-500/10">
          <CardContent className="p-4 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-semibold text-sm text-foreground">Sent to Your Omanut Marketer!</p>
              <p className="text-muted-foreground">
                Return to WhatsApp — your Marketer is replying right now with drafted captions and recommended posting times in your exact order.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {selectedIds.length > 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-primary">
                Your Posting Queue ({selectedIds.length} selected)
              </span>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            </div>
            <div className="space-y-2">
              {selectedIds.map((id, idx) => {
                const asset = candidates.find((c) => c.id === id);
                if (!asset) return null;
                return (
                  <div key={id} className="flex items-center gap-2.5 bg-background rounded-lg p-2 border">
                    <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0">
                      #{idx + 1}
                    </span>
                    <img src={asset.url} alt="" className="w-10 h-10 rounded object-cover shrink-0 bg-muted" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{asset.description || asset.file_name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {asset.recommended_format || asset.media_type}
                        {typeof asset.quality_score === 'number' ? ` • ${asset.quality_score}/10` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => moveItem(idx, -1)} disabled={idx === 0}>
                        <ArrowUp className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => moveItem(idx, 1)} disabled={idx === selectedIds.length - 1}>
                        <ArrowDown className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note for your Marketer (e.g. 'Push #1 on Friday payday with free Lusaka delivery')"
              rows={2}
              className="text-xs"
            />
            <Button onClick={handleSubmit} disabled={submitting} className="w-full gap-2">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Send Order to My Marketer on WhatsApp
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {candidates.map((asset) => {
          const rankIdx = selectedIds.indexOf(asset.id);
          const isPicked = rankIdx !== -1;
          return (
            <Card
              key={asset.id}
              onClick={() => togglePick(asset.id)}
              className={`cursor-pointer transition-all overflow-hidden ${
                isPicked ? 'ring-2 ring-primary border-primary' : 'hover:border-primary/40'
              }`}
            >
              <div className="relative aspect-video bg-muted">
                {asset.media_type === 'video' ? (
                  <video src={asset.url} className="w-full h-full object-cover" muted playsInline />
                ) : (
                  <img src={asset.url} alt={asset.file_name} className="w-full h-full object-cover" loading="lazy" />
                )}
                <div className="absolute top-2 left-2 flex items-center gap-1.5">
                  {isPicked ? (
                    <Badge className="bg-primary text-primary-foreground font-bold">Go #{rankIdx + 1}</Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-background/90">Tap to pick</Badge>
                  )}
                  {typeof asset.quality_score === 'number' && (
                    <Badge className="bg-emerald-600 text-white">
                      <Sparkles className="w-3 h-3 mr-1" />
                      {asset.quality_score}/10
                    </Badge>
                  )}
                </div>
              </div>
              <CardContent className="p-3 space-y-1.5">
                <p className="text-xs font-medium line-clamp-2">{asset.description || asset.file_name}</p>
                {Array.isArray(asset.ai_hook_suggestions) && asset.ai_hook_suggestions[0] && (
                  <p className="text-[11px] text-muted-foreground line-clamp-2">
                    💡 {asset.ai_hook_suggestions[0]}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
