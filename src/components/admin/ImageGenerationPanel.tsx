import { useState, useEffect } from 'react';
import { useCompany } from '@/context/CompanyContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { 
  Image, 
  ThumbsUp, 
  ThumbsDown, 
  Settings2, 
  BarChart3, 
  Sparkles,
  Calendar,
  ExternalLink,
  RefreshCw,
  Download,
  Eye
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface GeneratedImage {
  id: string;
  prompt: string;
  image_url: string;
  created_at: string;
  conversation_id?: string;
}

interface ImageFeedback {
  id: string;
  prompt: string;
  image_url: string;
  rating: number | null;
  feedback_type: string | null;
  caption_suggestion: string | null;
  was_posted: boolean;
  created_at: string;
}

interface ImageSettings {
  id: string;
  enabled: boolean;
  business_context: string | null;
  style_description: string | null;
  sample_prompts: string[] | null;
  top_performing_prompts: string[] | null;
  best_posting_times: string[] | null;
  learned_style_preferences: unknown;
}

export const ImageGenerationPanel = () => {
  const { selectedCompany } = useCompany();
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [feedback, setFeedback] = useState<ImageFeedback[]>([]);
  const [settings, setSettings] = useState<ImageSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  
  // Settings form state
  const [enabled, setEnabled] = useState(false);
  const [businessContext, setBusinessContext] = useState('');
  const [styleDescription, setStyleDescription] = useState('');
  const [samplePrompts, setSamplePrompts] = useState('');

  useEffect(() => {
    if (selectedCompany) {
      loadData();
    }
  }, [selectedCompany]);

  const loadData = async () => {
    if (!selectedCompany) return;
    setLoading(true);
    
    try {
      // Load generated images
      const { data: imagesData } = await supabase
        .from('generated_images')
        .select('*')
        .eq('company_id', selectedCompany.id)
        .order('created_at', { ascending: false })
        .limit(50);
      
      setImages(imagesData || []);

      // Load feedback data
      const { data: feedbackData } = await supabase
        .from('image_generation_feedback')
        .select('*')
        .eq('company_id', selectedCompany.id)
        .order('created_at', { ascending: false })
        .limit(100);
      
      setFeedback(feedbackData || []);

      // Load settings
      const { data: settingsData } = await supabase
        .from('image_generation_settings')
        .select('*')
        .eq('company_id', selectedCompany.id)
        .single();
      
      if (settingsData) {
        setSettings(settingsData);
        setEnabled(settingsData.enabled);
        setBusinessContext(settingsData.business_context || '');
        setStyleDescription(settingsData.style_description || '');
        setSamplePrompts((settingsData.sample_prompts || []).join('\n'));
      } else {
        // Create default settings
        const { data: newSettings } = await supabase
          .from('image_generation_settings')
          .insert({
            company_id: selectedCompany.id,
            enabled: false
          })
          .select()
          .single();
        
        if (newSettings) {
          setSettings(newSettings);
        }
      }
    } catch (error) {
      console.error('Error loading image data:', error);
      toast.error('Failed to load image data');
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!selectedCompany || !settings) return;
    setSaving(true);

    try {
      const { error } = await supabase
        .from('image_generation_settings')
        .update({
          enabled,
          business_context: businessContext || null,
          style_description: styleDescription || null,
          sample_prompts: samplePrompts.split('\n').filter(p => p.trim())
        })
        .eq('company_id', selectedCompany.id);

      if (error) throw error;
      toast.success('Settings saved successfully');
      loadData();
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  // Analytics calculations
  const totalImages = images.length;
  const thumbsUp = feedback.filter(f => f.feedback_type === 'thumbs_up').length;
  const thumbsDown = feedback.filter(f => f.feedback_type === 'thumbs_down').length;
  const avgRating = feedback.filter(f => f.rating).reduce((sum, f) => sum + (f.rating || 0), 0) / (feedback.filter(f => f.rating).length || 1);
  const postedCount = feedback.filter(f => f.was_posted).length;

  if (!selectedCompany) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Select a company to manage image generation
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            Image Generation
          </h2>
          <p className="text-muted-foreground">
            Manage AI-generated images and configure settings for {selectedCompany.name}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Analytics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Image className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalImages}</p>
                <p className="text-xs text-muted-foreground">Total Images</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <ThumbsUp className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{thumbsUp}</p>
                <p className="text-xs text-muted-foreground">Positive Feedback</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10">
                <ThumbsDown className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{thumbsDown}</p>
                <p className="text-xs text-muted-foreground">Negative Feedback</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <BarChart3 className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{avgRating.toFixed(1)}</p>
                <p className="text-xs text-muted-foreground">Avg Rating</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="gallery" className="space-y-4">
        <TabsList>
          <TabsTrigger value="gallery" className="gap-2">
            <Image className="h-4 w-4" />
            Gallery
          </TabsTrigger>
          <TabsTrigger value="feedback" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Feedback
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings2 className="h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        {/* Gallery Tab */}
        <TabsContent value="gallery">
          <Card>
            <CardHeader>
              <CardTitle>Generated Images</CardTitle>
              <CardDescription>
                All AI-generated images for this company ({images.length} total)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {images.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Image className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No images generated yet</p>
                  <p className="text-sm">Images will appear here when customers use the image generation feature</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {images.map((image) => (
                    <div
                      key={image.id}
                      className="group relative aspect-square rounded-lg overflow-hidden border bg-muted cursor-pointer hover:ring-2 hover:ring-primary transition-all"
                      onClick={() => setSelectedImage(image)}
                    >
                      {image.image_url.startsWith('data:') ? (
                        <img
                          src={image.image_url}
                          alt={image.prompt}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Image className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                        <p className="text-white text-xs line-clamp-2">{image.prompt}</p>
                      </div>
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button size="icon" variant="secondary" className="h-7 w-7">
                          <Eye className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Feedback Tab */}
        <TabsContent value="feedback">
          <Card>
            <CardHeader>
              <CardTitle>Feedback Analytics</CardTitle>
              <CardDescription>
                User feedback on generated images
              </CardDescription>
            </CardHeader>
            <CardContent>
              {feedback.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No feedback recorded yet</p>
                </div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="space-y-3">
                    {feedback.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-start gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                      >
                        <div className="w-16 h-16 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                          {item.image_url?.startsWith('data:') ? (
                            <img
                              src={item.image_url}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Image className="h-6 w-6 text-muted-foreground" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.prompt}</p>
                          <div className="flex items-center gap-2 mt-1">
                            {item.feedback_type === 'thumbs_up' && (
                              <Badge variant="secondary" className="bg-green-500/10 text-green-600">
                                <ThumbsUp className="h-3 w-3 mr-1" />
                                Liked
                              </Badge>
                            )}
                            {item.feedback_type === 'thumbs_down' && (
                              <Badge variant="secondary" className="bg-red-500/10 text-red-600">
                                <ThumbsDown className="h-3 w-3 mr-1" />
                                Disliked
                              </Badge>
                            )}
                            {item.rating && (
                              <Badge variant="outline">
                                Rating: {item.rating}/5
                              </Badge>
                            )}
                            {item.was_posted && (
                              <Badge variant="secondary" className="bg-blue-500/10 text-blue-600">
                                <Calendar className="h-3 w-3 mr-1" />
                                Posted
                              </Badge>
                            )}
                          </div>
                          {item.caption_suggestion && (
                            <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                              Caption: {item.caption_suggestion}
                            </p>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground flex-shrink-0">
                          {new Date(item.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}

              {/* Top Performing Prompts */}
              {settings?.top_performing_prompts && settings.top_performing_prompts.length > 0 && (
                <div className="mt-6 pt-6 border-t">
                  <h4 className="font-medium mb-3">Top Performing Prompts</h4>
                  <div className="space-y-2">
                    {settings.top_performing_prompts.slice(0, 5).map((prompt, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <Badge variant="outline" className="flex-shrink-0">#{i + 1}</Badge>
                        <span className="truncate">{prompt}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle>Image Generation Settings</CardTitle>
              <CardDescription>
                Configure how AI generates images for this company
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
                <div>
                  <Label htmlFor="enabled" className="text-base font-medium">Enable Image Generation</Label>
                  <p className="text-sm text-muted-foreground">
                    Allow customers to request AI-generated images via WhatsApp
                  </p>
                </div>
                <Switch
                  id="enabled"
                  checked={enabled}
                  onCheckedChange={setEnabled}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="context">Business Context</Label>
                <Textarea
                  id="context"
                  placeholder="Describe your business, products, brand style, target audience..."
                  value={businessContext}
                  onChange={(e) => setBusinessContext(e.target.value)}
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  This helps the AI understand your business and create relevant images
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="style">Style Description</Label>
                <Textarea
                  id="style"
                  placeholder="Modern, vibrant colors, professional photography style..."
                  value={styleDescription}
                  onChange={(e) => setStyleDescription(e.target.value)}
                  rows={2}
                />
                <p className="text-xs text-muted-foreground">
                  Describe the visual style you want for generated images
                </p>
              </div>

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
                  Example prompts to guide the AI style. These will be suggested to users.
                </p>
              </div>

              <Button onClick={saveSettings} disabled={saving} className="w-full">
                {saving ? 'Saving...' : 'Save Settings'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Image Preview Dialog */}
      <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Image Details</DialogTitle>
          </DialogHeader>
          {selectedImage && (
            <div className="space-y-4">
              <div className="aspect-video rounded-lg overflow-hidden bg-muted">
                {selectedImage.image_url.startsWith('data:') ? (
                  <img
                    src={selectedImage.image_url}
                    alt={selectedImage.prompt}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Image className="h-16 w-16 text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Prompt</p>
                <p className="text-sm text-muted-foreground bg-muted p-3 rounded-lg">
                  {selectedImage.prompt}
                </p>
              </div>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Created: {new Date(selectedImage.created_at).toLocaleString()}</span>
                {selectedImage.image_url.startsWith('data:') && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = selectedImage.image_url;
                      link.download = `image-${selectedImage.id}.png`;
                      link.click();
                    }}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
