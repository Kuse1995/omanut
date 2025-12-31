import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { 
  Palette, 
  Save,
  Loader2,
  Plus,
  X,
  Type,
  Sparkles
} from 'lucide-react';
import { Json } from '@/integrations/supabase/types';

interface BrandColor {
  name: string;
  hex: string;
}

interface BrandFont {
  name: string;
  usage: string;
}

interface BrandVisualProfileProps {
  companyId: string;
}

export const BrandVisualProfile = ({ companyId }: BrandVisualProfileProps) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Settings state
  const [enabled, setEnabled] = useState(false);
  const [businessContext, setBusinessContext] = useState('');
  const [styleDescription, setStyleDescription] = useState('');
  const [brandTone, setBrandTone] = useState('');
  const [visualGuidelines, setVisualGuidelines] = useState('');
  const [brandColors, setBrandColors] = useState<BrandColor[]>([]);
  const [brandFonts, setBrandFonts] = useState<BrandFont[]>([]);
  const [samplePrompts, setSamplePrompts] = useState('');

  // New color/font input state
  const [newColorName, setNewColorName] = useState('');
  const [newColorHex, setNewColorHex] = useState('#000000');
  const [newFontName, setNewFontName] = useState('');
  const [newFontUsage, setNewFontUsage] = useState('');

  useEffect(() => {
    loadSettings();
  }, [companyId]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('image_generation_settings')
        .select('*')
        .eq('company_id', companyId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        setEnabled(data.enabled);
        setBusinessContext(data.business_context || '');
        setStyleDescription(data.style_description || '');
        setBrandTone(data.brand_tone || '');
        setVisualGuidelines(data.visual_guidelines || '');
        setBrandColors(parseJsonArray<BrandColor>(data.brand_colors));
        setBrandFonts(parseJsonArray<BrandFont>(data.brand_fonts));
        setSamplePrompts((data.sample_prompts || []).join('\n'));
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      toast.error('Failed to load brand settings');
    } finally {
      setLoading(false);
    }
  };

  const parseJsonArray = <T,>(json: Json | null): T[] => {
    if (!json) return [];
    if (Array.isArray(json)) return json as T[];
    return [];
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('image_generation_settings')
        .upsert({
          company_id: companyId,
          enabled,
          business_context: businessContext || null,
          style_description: styleDescription || null,
          brand_tone: brandTone || null,
          visual_guidelines: visualGuidelines || null,
          brand_colors: brandColors as unknown as Json,
          brand_fonts: brandFonts as unknown as Json,
          sample_prompts: samplePrompts.split('\n').filter(p => p.trim())
        }, {
          onConflict: 'company_id'
        });

      if (error) throw error;
      toast.success('Brand profile saved');
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const addColor = () => {
    if (!newColorName.trim()) return;
    setBrandColors([...brandColors, { name: newColorName, hex: newColorHex }]);
    setNewColorName('');
    setNewColorHex('#000000');
  };

  const removeColor = (index: number) => {
    setBrandColors(brandColors.filter((_, i) => i !== index));
  };

  const addFont = () => {
    if (!newFontName.trim()) return;
    setBrandFonts([...brandFonts, { name: newFontName, usage: newFontUsage }]);
    setNewFontName('');
    setNewFontUsage('');
  };

  const removeFont = (index: number) => {
    setBrandFonts(brandFonts.filter((_, i) => i !== index));
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          Brand Visual Profile
        </CardTitle>
        <CardDescription>
          Define your brand's visual identity to guide AI image generation
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Enable Toggle */}
        <div className="flex items-center justify-between p-4 rounded-lg border">
          <div>
            <Label className="text-base font-medium">Enable AI Image Generation</Label>
            <p className="text-sm text-muted-foreground">
              Allow AI to generate images using your brand profile
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        {/* Business Context */}
        <div className="space-y-2">
          <Label htmlFor="context">Business Context</Label>
          <Textarea
            id="context"
            placeholder="Describe your business, products, target audience..."
            value={businessContext}
            onChange={(e) => setBusinessContext(e.target.value)}
            rows={3}
          />
        </div>

        {/* Style Description */}
        <div className="space-y-2">
          <Label htmlFor="style">Visual Style</Label>
          <Textarea
            id="style"
            placeholder="Modern, minimalist, vibrant colors..."
            value={styleDescription}
            onChange={(e) => setStyleDescription(e.target.value)}
            rows={2}
          />
        </div>

        {/* Brand Tone */}
        <div className="space-y-2">
          <Label htmlFor="tone">Brand Tone</Label>
          <Input
            id="tone"
            placeholder="Professional, playful, luxurious, friendly..."
            value={brandTone}
            onChange={(e) => setBrandTone(e.target.value)}
          />
        </div>

        {/* Visual Guidelines */}
        <div className="space-y-2">
          <Label htmlFor="guidelines">Visual Guidelines</Label>
          <Textarea
            id="guidelines"
            placeholder="Specific rules for AI to follow when generating images..."
            value={visualGuidelines}
            onChange={(e) => setVisualGuidelines(e.target.value)}
            rows={3}
          />
        </div>

        {/* Brand Colors */}
        <div className="space-y-3">
          <Label className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            Brand Colors
          </Label>
          
          <div className="flex flex-wrap gap-2">
            {brandColors.map((color, index) => (
              <Badge 
                key={index} 
                variant="outline" 
                className="gap-2 pr-1"
              >
                <div 
                  className="w-4 h-4 rounded-full border"
                  style={{ backgroundColor: color.hex }}
                />
                {color.name}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4"
                  onClick={() => removeColor(index)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            ))}
          </div>

          <div className="flex gap-2">
            <Input
              placeholder="Color name"
              value={newColorName}
              onChange={(e) => setNewColorName(e.target.value)}
              className="flex-1"
            />
            <Input
              type="color"
              value={newColorHex}
              onChange={(e) => setNewColorHex(e.target.value)}
              className="w-14 p-1 h-10"
            />
            <Button variant="outline" size="icon" onClick={addColor}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Brand Fonts */}
        <div className="space-y-3">
          <Label className="flex items-center gap-2">
            <Type className="h-4 w-4" />
            Brand Fonts
          </Label>
          
          <div className="flex flex-wrap gap-2">
            {brandFonts.map((font, index) => (
              <Badge 
                key={index} 
                variant="secondary" 
                className="gap-1 pr-1"
              >
                {font.name}
                {font.usage && <span className="text-muted-foreground">({font.usage})</span>}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4"
                  onClick={() => removeFont(index)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            ))}
          </div>

          <div className="flex gap-2">
            <Input
              placeholder="Font name"
              value={newFontName}
              onChange={(e) => setNewFontName(e.target.value)}
              className="flex-1"
            />
            <Input
              placeholder="Usage (headings, body...)"
              value={newFontUsage}
              onChange={(e) => setNewFontUsage(e.target.value)}
              className="flex-1"
            />
            <Button variant="outline" size="icon" onClick={addFont}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Sample Prompts */}
        <div className="space-y-2">
          <Label htmlFor="prompts">Sample Prompts (one per line)</Label>
          <Textarea
            id="prompts"
            placeholder="Product showcase with lifestyle setting&#10;Behind-the-scenes content&#10;Customer testimonial visual"
            value={samplePrompts}
            onChange={(e) => setSamplePrompts(e.target.value)}
            rows={4}
          />
          <p className="text-xs text-muted-foreground">
            These prompts will be suggested to users and used as examples
          </p>
        </div>

        <Button onClick={handleSave} disabled={saving} className="w-full">
          {saving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Brand Profile
        </Button>
      </CardContent>
    </Card>
  );
};
