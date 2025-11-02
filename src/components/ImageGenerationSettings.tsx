import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Sparkles, Loader2 } from 'lucide-react';

interface ImageGenerationSettingsProps {
  companyId: string;
}

export const ImageGenerationSettings = ({ companyId }: ImageGenerationSettingsProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({
    enabled: false,
    business_context: '',
    style_description: '',
    sample_prompts: [] as string[]
  });

  useEffect(() => {
    loadSettings();
  }, [companyId]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('image_generation_settings')
        .select('*')
        .eq('company_id', companyId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        setSettings({
          enabled: data.enabled,
          business_context: data.business_context || '',
          style_description: data.style_description || '',
          sample_prompts: data.sample_prompts || []
        });
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      toast({
        title: 'Error',
        description: 'Failed to load image generation settings',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('image_generation_settings')
        .upsert({
          company_id: companyId,
          enabled: settings.enabled,
          business_context: settings.business_context,
          style_description: settings.style_description,
          sample_prompts: settings.sample_prompts
        });

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Image generation settings saved successfully'
      });
    } catch (error) {
      console.error('Error saving settings:', error);
      toast({
        title: 'Error',
        description: 'Failed to save settings',
        variant: 'destructive'
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
