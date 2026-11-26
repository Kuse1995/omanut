import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Sparkles, Send, Wand2, CalendarPlus, Loader2 } from 'lucide-react';
import type { CallA2UIFn, StudioCreatives } from './types';

interface CreativeStudioSurfaceProps {
  creatives: StudioCreatives;
  callA2UI: CallA2UIFn;
}

const TWEAK_CHIPS = [
  'Warmer lighting',
  'Add Kwacha price badge',
  'Cleaner lifestyle backdrop',
  'Turn into a 9:16 Reel',
];

export function CreativeStudioSurface({ creatives, callA2UI }: CreativeStudioSurfaceProps) {
  const [selectedUrl, setSelectedUrl] = useState<string | null>(
    creatives.images[0]?.image_url || creatives.videos[0]?.video_url || null
  );
  const [selectedType, setSelectedType] = useState<'image' | 'video'>(
    creatives.images[0]?.image_url ? 'image' : 'video'
  );
  const [tweakText, setTweakText] = useState('');
  const [sending, setSending] = useState(false);

  const items = [
    ...creatives.images.map((img) => ({
      id: img.id,
      type: 'image' as const,
      url: img.image_url,
      prompt: img.prompt,
      created_at: img.created_at,
    })),
    ...creatives.videos
      .filter((v) => v.video_url)
      .map((v) => ({
        id: v.id,
        type: 'video' as const,
        url: v.video_url as string,
        prompt: v.prompt || 'AI Marketing Reel',
        created_at: v.created_at,
      })),
  ].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  const sendAction = async (mode: 'schedule_now' | 'request_tweak', note?: string) => {
    if (!selectedUrl) {
      toast.error('Select an image or Reel first');
      return;
    }
    setSending(true);
    try {
      await callA2UI('creative_action', {
        mode,
        media_url: selectedUrl,
        media_type: selectedType,
        tweak_instruction: note ?? tweakText,
      });
      toast.success(
        mode === 'schedule_now'
          ? 'Sent to WhatsApp! Your Marketer is writing the caption & scheduling it now.'
          : 'Sent tweak request! Check WhatsApp for your updated version.'
      );
      setTweakText('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setSending(false);
    }
  };

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          No AI images or Reels generated yet. Message your Omanut Marketer on WhatsApp to create your first branded ad or Reel!
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {selectedUrl && (
        <Card className="overflow-hidden border-primary/40">
          <div className="aspect-video bg-black/90 flex items-center justify-center">
            {selectedType === 'video' ? (
              <video src={selectedUrl} controls playsInline className="max-h-72 w-full object-contain" />
            ) : (
              <img src={selectedUrl} alt="Selected creative" className="max-h-72 w-full object-contain" />
            )}
          </div>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {TWEAK_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  disabled={sending}
                  onClick={() => sendAction('request_tweak', chip)}
                  className="px-2.5 py-1 rounded-full border text-xs bg-muted/50 hover:bg-primary/10 hover:border-primary/40 transition-colors"
                >
                  <Wand2 className="w-3 h-3 inline mr-1" />
                  {chip}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <Input
                value={tweakText}
                onChange={(e) => setTweakText(e.target.value)}
                placeholder="Custom tweak (e.g. 'Make text bigger, add K150')"
                className="text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={sending || !tweakText.trim()}
                onClick={() => sendAction('request_tweak')}
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>

            <Button onClick={() => sendAction('schedule_now')} disabled={sending} className="w-full gap-2">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-4 h-4" />}
              Use This One — Send to Marketer to Post / Schedule
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {items.map((item) => {
          const active = selectedUrl === item.url;
          return (
            <div
              key={item.id}
              onClick={() => {
                setSelectedUrl(item.url);
                setSelectedType(item.type);
              }}
              className={`relative aspect-square rounded-lg overflow-hidden bg-muted cursor-pointer border-2 transition-all ${
                active ? 'border-primary ring-2 ring-primary/30' : 'border-transparent hover:border-primary/30'
              }`}
            >
              {item.type === 'video' ? (
                <video src={item.url} className="w-full h-full object-cover" muted playsInline />
              ) : (
                <img src={item.url} alt={item.prompt} className="w-full h-full object-cover" loading="lazy" />
              )}
              <Badge variant="secondary" className="absolute top-1.5 left-1.5 text-[10px] px-1.5 py-0 bg-background/90">
                <Sparkles className="w-2.5 h-2.5 mr-1" />
                {item.type === 'video' ? 'Reel' : 'Graphic'}
              </Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}
