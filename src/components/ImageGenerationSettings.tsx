import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Sparkles, Loader2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ImageGenerationSettingsProps {
  companyId: string;
}

interface MediaItem {
  id: string;
  file_name: string;
  file_path: string;
  description: string | null;
  category: string;
  public_url: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const MAX_REFS = 4;

export const ImageGenerationSettings = ({ companyId }: ImageGenerationSettingsProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [settings, setSettings] = useState({
    enabled: false,
    business_context: '',
    style_description: '',
    sample_prompts: [] as string[],
    reference_asset_ids: [] as string[],
  });

  useEffect(() => {
    loadAll();
  }, [companyId]);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [settingsRes, mediaRes] = await Promise.all([
        supabase
          .from('image_generation_settings')
          .select('*')
          .eq('company_id', companyId)
          .maybeSingle(),
        supabase
          .from('company_media')
          .select('id, file_name, file_path, description, category')
          .eq('company_id', companyId)
          .eq('media_type', 'image')
          .in('category', ['products', 'logos', 'promotional'])
          .order('created_at', { ascending: false })
          .limit(60),
      ]);

      if (settingsRes.error && settingsRes.error.code !== 'PGRST116') throw settingsRes.error;
      if (settingsRes.data) {
        setSettings({
          enabled: settingsRes.data.enabled,
          business_context: settingsRes.data.business_context || '',
          style_description: settingsRes.data.style_description || '',
          sample_prompts: settingsRes.data.sample_prompts || [],
          reference_asset_ids: settingsRes.data.reference_asset_ids || [],
        });
      }

      if (mediaRes.data) {
        setMedia(
          mediaRes.data.map((m: any) => ({
            ...m,
            public_url: `${SUPABASE_URL}/storage/v1/object/public/company-media/${m.file_path}`,
          })),
        );
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      toast({
        title: 'Error',
        description: 'Failed to load image generation settings',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleReference = (id: string) => {
    setSettings(prev => {
      const has = prev.reference_asset_ids.includes(id);
      if (has) {
        return { ...prev, reference_asset_ids: prev.reference_asset_ids.filter(x => x !== id) };
      }
      if (prev.reference_asset_ids.length >= MAX_REFS) {
        toast({
          title: 'Reference limit',
          description: `You can pin up to ${MAX_REFS} references.`,
        });
        return prev;
      }
      return { ...prev, reference_asset_ids: [...prev.reference_asset_ids, id] };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('image_generation_settings')
        .upsert(
          {
            company_id: companyId,
            enabled: settings.enabled,
            business_context: settings.business_context,
            style_description: settings.style_description,
            sample_prompts: settings.sample_prompts,
            reference_asset_ids: settings.reference_asset_ids,
          },
          { onConflict: 'company_id' },
        );

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Image generation settings saved successfully',
      });
    } catch (error) {
      console.error('Error saving settings:', error);
      toast({
        title: 'Error',
        description: 'Failed to save settings',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="card-glass">
        <CardContent className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="card-glass">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          AI Image Generation
        </CardTitle>
        <CardDescription>
          Generate and share business-relevant images with customers (hairstyles, clothing, menu items, etc.)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Enable Image Generation</Label>
            <p className="text-sm text-muted-foreground">
              Allow AI to generate images for your business
            </p>
          </div>
          <Switch
            checked={settings.enabled}
            onCheckedChange={(checked) => setSettings({ ...settings, enabled: checked })}
          />
        </div>

        {settings.enabled && (
          <>
            <div>
              <Label htmlFor="business_context">Business Context</Label>
              <Textarea
                id="business_context"
                value={settings.business_context}
                onChange={(e) => setSettings({ ...settings, business_context: e.target.value })}
                placeholder="e.g., Modern hair salon specializing in contemporary cuts and coloring..."
                className="min-h-[80px]"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Describe your business to help AI generate relevant images
              </p>
            </div>

            <div>
              <Label htmlFor="style_description">Style Description</Label>
              <Textarea
                id="style_description"
                value={settings.style_description}
                onChange={(e) => setSettings({ ...settings, style_description: e.target.value })}
                placeholder="e.g., Clean, professional aesthetic with natural lighting..."
                className="min-h-[60px]"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Define the visual style for generated images
              </p>
            </div>

            {/* ────────────────────────────────────────────────── */}
            {/* Reference product photos picker                    */}
            {/* ────────────────────────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Reference product photos</Label>
                <span className="text-xs text-muted-foreground">
                  {settings.reference_asset_ids.length}/{MAX_REFS} selected
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                These photos will be used as visual anchors for every AI-generated image. Pick 1–{MAX_REFS} so generations match your real products.
              </p>
              {media.length === 0 ? (
                <div className="text-sm text-muted-foreground bg-muted/40 p-4 rounded-lg">
                  No product, logo, or promotional images in your library yet. Upload some in Media to use as references.
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 max-h-64 overflow-y-auto p-1">
                  {media.map((m) => {
                    const selected = settings.reference_asset_ids.includes(m.id);
                    return (
                      <button
                        type="button"
                        key={m.id}
                        onClick={() => toggleReference(m.id)}
                        className={cn(
                          'relative aspect-square rounded-md overflow-hidden border-2 transition-all',
                          selected
                            ? 'border-primary ring-2 ring-primary/30'
                            : 'border-border hover:border-muted-foreground/50',
                        )}
                        title={m.description || m.file_name}
                      >
                        <img
                          src={m.public_url}
                          alt={m.description || m.file_name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                        {selected && (
                          <div className="absolute top-1 right-1 bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center">
                            <Check className="w-3 h-3" />
                          </div>
                        )}
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent text-[10px] text-white px-1 py-0.5 truncate">
                          {m.category}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="bg-muted/50 p-4 rounded-lg space-y-2">
              <p className="text-sm font-medium">Example Use Cases:</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Salons: Show hairstyle options to customers</li>
                <li>• Boutiques: Display clothing styles and combinations</li>
                <li>• Restaurants: Visualize menu items and presentations</li>
                <li>• Spas: Share treatment room setups and ambiance</li>
              </ul>
            </div>
          </>
        )}

        <Button
          onClick={handleSave}
          disabled={saving}
          className="w-full"
        >
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Settings'
          )}
        </Button>
      </CardContent>
    </Card>
  );
};
