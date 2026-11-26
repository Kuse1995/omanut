import { useState, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Save, Loader2, ShieldCheck, Upload } from 'lucide-react';
import type { CallA2UIFn, StudioBrandKit, StudioImageSettings, StudioSubscription } from './types';

interface BrandDnaSurfaceProps {
  brandKit: StudioBrandKit | null;
  imageSettings: StudioImageSettings | null;
  subscription: StudioSubscription | null;
  callA2UI: CallA2UIFn;
  onRefresh: () => Promise<void>;
}

const AUTOPILOT_MODES: Array<{
  key: 'copilot' | 'weekly_batch' | 'full_autopilot';
  title: string;
  desc: string;
}> = [
  {
    key: 'copilot',
    title: 'Co-Pilot (Approve Every Post)',
    desc: 'Your Marketer drafts visuals & captions and waits for your 1-tap approval on WhatsApp before posting.',
  },
  {
    key: 'weekly_batch',
    title: 'Weekly Batch (Recommended)',
    desc: 'Approve your whole week every Monday morning in 60 seconds; Omanut handles publishing automatically all week.',
  },
  {
    key: 'full_autopilot',
    title: 'Full Autopilot + 2h Safety Veto',
    desc: 'Auto-creates & schedules from your Vault and sends a WhatsApp preview 2 hours before going live.',
  },
];

export function BrandDnaSurface({
  brandKit,
  imageSettings,
  subscription,
  callA2UI,
  onRefresh,
}: BrandDnaSurfaceProps) {
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [logoUrl, setLogoUrl] = useState(brandKit?.logo_url || '');
  const [logoUploading, setLogoUploading] = useState(false);
  const [primaryColor, setPrimaryColor] = useState(brandKit?.colors?.primary || '#10B981');
  const [secondaryColor, setSecondaryColor] = useState(brandKit?.colors?.secondary || '#111827');
  const [tone, setTone] = useState(brandKit?.tone || imageSettings?.brand_tone || 'Warm, confident, vibrant');
  const [styleDescription, setStyleDescription] = useState(imageSettings?.style_description || '');
  const [guidelines, setGuidelines] = useState(brandKit?.guidelines || '');
  const [noGo, setNoGo] = useState(brandKit?.no_go_phrases || '');
  const [autopilot, setAutopilot] = useState<'copilot' | 'weekly_batch' | 'full_autopilot'>(
    subscription?.autopilot_level || 'copilot'
  );
  const [saving, setSaving] = useState(false);

  const handleLogoUpload = async (file: File | undefined) => {
    if (!file) return;
    setLogoUploading(true);
    try {
      const minted = await callA2UI<{
        uploads: Array<{ signed_url: string; public_url: string; file_path: string; media_type: 'image' | 'video' }>;
      }>('mint_upload_urls', {
        files: [{ file_name: file.name, content_type: file.type || 'image/png', file_size: file.size }],
      });
      const up = minted.uploads?.[0];
      if (!up) throw new Error('Could not prepare logo upload');
      const putRes = await fetch(up.signed_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'image/png' },
        body: file,
      });
      if (!putRes.ok) throw new Error('Logo upload failed');
      setLogoUrl(up.public_url);
      await callA2UI('save_brand_dna', { logo_url: up.public_url });
      toast.success('Brand logo uploaded!');
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Logo upload failed');
    } finally {
      setLogoUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await callA2UI('save_brand_dna', {
        logo_url: logoUrl || undefined,
        colors: { primary: primaryColor, secondary: secondaryColor },
        tone,
        style_description: styleDescription,
        guidelines,
        no_go_phrases: noGo,
        autopilot_level: autopilot,
      });
      toast.success('Brand DNA & Autopilot settings saved!');
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between gap-3 pb-1 border-b">
            <div className="flex items-center gap-3">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="w-12 h-12 rounded-xl object-cover border bg-muted" />
              ) : (
                <div className="w-12 h-12 rounded-xl border border-dashed flex items-center justify-center text-xs text-muted-foreground">
                  Logo
                </div>
              )}
              <div>
                <p className="text-xs font-medium">Business Logo</p>
                <p className="text-[11px] text-muted-foreground">Used automatically on AI promo graphics</p>
              </div>
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void handleLogoUpload(e.target.files?.[0])}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={logoUploading}
              onClick={() => logoInputRef.current?.click()}
              className="gap-1.5 text-xs"
            >
              {logoUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Upload Logo
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Primary Brand Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="w-10 h-9 rounded border cursor-pointer bg-transparent"
                />
                <Input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="text-xs font-mono" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Accent / Dark Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={secondaryColor}
                  onChange={(e) => setSecondaryColor(e.target.value)}
                  className="w-10 h-9 rounded border cursor-pointer bg-transparent"
                />
                <Input value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} className="text-xs font-mono" />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Brand Voice & Tone</Label>
            <Input
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              placeholder="e.g. Friendly, premium Lusaka hospitality, confident and helpful"
              className="text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Visual Style (for AI Images & Reels)</Label>
            <Textarea
              value={styleDescription}
              onChange={(e) => setStyleDescription(e.target.value)}
              rows={2}
              placeholder="e.g. Clean warm sunlight, vibrant local lifestyle setting, crisp product packaging"
              className="text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Brand Rules & Key Details</Label>
            <Textarea
              value={guidelines}
              onChange={(e) => setGuidelines(e.target.value)}
              rows={2}
              placeholder="Always mention free delivery over K500 in Lusaka; keep captions crisp."
              className="text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Words / Phrases to NEVER Use (comma-separated)</Label>
            <Input
              value={noGo}
              onChange={(e) => setNoGo(e.target.value)}
              placeholder="e.g. cheap, second-hand, game-changer"
              className="text-xs"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-sm">Autopilot Trust Level</h3>
          </div>
          <div className="space-y-2">
            {AUTOPILOT_MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setAutopilot(m.key)}
                className={`w-full text-left p-3 rounded-lg border transition-all ${
                  autopilot === m.key
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/40'
                }`}
              >
                <p className="text-xs font-semibold text-foreground">{m.title}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{m.desc}</p>
              </button>
            ))}
          </div>

          <Button onClick={handleSave} disabled={saving} className="w-full gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Brand DNA
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
