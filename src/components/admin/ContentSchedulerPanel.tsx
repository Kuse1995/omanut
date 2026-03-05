import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCompany } from '@/context/CompanyContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar, Clock, Send, Loader2, AlertCircle, CheckCircle2, FileText, Trash2, ImagePlus, X, Upload, Facebook, Instagram } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

export const ContentSchedulerPanel = () => {
  const { selectedCompany } = useCompany();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [content, setContent] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [selectedPageId, setSelectedPageId] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [targetPlatform, setTargetPlatform] = useState<'facebook' | 'instagram' | 'both'>('facebook');
  const [publishMode, setPublishMode] = useState<'schedule' | 'now'>('schedule');

  // Fetch meta credentials (pages) for this company
  const { data: pages } = useQuery({
    queryKey: ['meta-pages', selectedCompany?.id],
    queryFn: async () => {
      if (!selectedCompany) return [];
      const { data, error } = await supabase
        .from('meta_credentials')
        .select('id, page_id, platform, ig_user_id')
        .eq('company_id', selectedCompany.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedCompany,
  });

  // Fetch approved generated images for this company
  const { data: generatedImages } = useQuery({
    queryKey: ['generated-images-approved', selectedCompany?.id],
    queryFn: async () => {
      if (!selectedCompany) return [];
      const { data, error } = await supabase
        .from('generated_images')
        .select('id, image_url, prompt, created_at')
        .eq('company_id', selectedCompany.id)
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedCompany,
  });

  // Fetch scheduled posts
  const { data: posts, isLoading: postsLoading } = useQuery({
    queryKey: ['scheduled-posts', selectedCompany?.id],
    queryFn: async () => {
      if (!selectedCompany) return [];
      const { data, error } = await supabase
        .from('scheduled_posts')
        .select('*')
        .eq('company_id', selectedCompany.id)
        .order('scheduled_time', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedCompany,
  });

  // Upload image to company-media bucket
  const handleImageUpload = async (file: File) => {
    if (!selectedCompany) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `scheduled-posts/${selectedCompany.id}/${crypto.randomUUID()}.${ext}`;

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('Not authenticated');

      const { error } = await supabase.storage
        .from('company-media')
        .upload(path, file, { upsert: false });
      if (error) throw error;

      const { data: publicData } = supabase.storage
        .from('company-media')
        .getPublicUrl(path);

      setImageUrl(publicData.publicUrl);
      setImagePickerOpen(false);
      toast.success('Image uploaded');
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  // Create draft & schedule
  const scheduleMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCompany) throw new Error('No company selected');
      if (!content.trim()) throw new Error('Post content is required');
      if (!scheduledDate || !scheduledTime) throw new Error('Date and time are required');
      if (!selectedPageId) throw new Error('Select a page');

      // Instagram requires an image
      if ((targetPlatform === 'instagram' || targetPlatform === 'both') && !imageUrl) {
        throw new Error('Instagram posts require an image. Please attach one.');
      }

      const scheduledTimeISO = new Date(`${scheduledDate}T${scheduledTime}`).toISOString();

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: post, error: insertError } = await supabase
        .from('scheduled_posts')
        .insert({
          company_id: selectedCompany.id,
          page_id: selectedPageId,
          content: content.trim(),
          scheduled_time: scheduledTimeISO,
          status: 'draft',
          created_by: user.id,
          image_url: imageUrl || null,
          target_platform: targetPlatform,
        })
        .select('id')
        .single();

      if (insertError) throw insertError;

      const { data: result, error: fnError } = await supabase.functions.invoke('schedule-meta-post', {
        body: { post_id: post.id },
      });

      if (fnError) {
        const errMsg = typeof fnError === 'object' && fnError.message ? fnError.message : String(fnError);
        throw new Error(errMsg);
      }
      if (result?.error) throw new Error(result.error);

      return result;
    },
    onSuccess: () => {
      const label = targetPlatform === 'both' ? 'Facebook + Instagram' : targetPlatform === 'instagram' ? 'Instagram' : 'Facebook';
      toast.success(`Post scheduled on ${label}!`);
      setContent('');
      setScheduledDate('');
      setScheduledTime('');
      setImageUrl('');
      queryClient.invalidateQueries({ queryKey: ['scheduled-posts'] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Delete a post
  const deleteMutation = useMutation({
    mutationFn: async (postId: string) => {
      const { error } = await supabase
        .from('scheduled_posts')
        .delete()
        .eq('id', postId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Post deleted');
      queryClient.invalidateQueries({ queryKey: ['scheduled-posts'] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const statusBadge = (status: string) => {
    switch (status) {
      case 'scheduled':
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30"><Clock className="w-3 h-3 mr-1" />Scheduled</Badge>;
      case 'published':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle2 className="w-3 h-3 mr-1" />Published</Badge>;
      case 'failed':
        return <Badge className="bg-destructive/20 text-destructive border-destructive/30"><AlertCircle className="w-3 h-3 mr-1" />Failed</Badge>;
      default:
        return <Badge variant="secondary"><FileText className="w-3 h-3 mr-1" />Draft</Badge>;
    }
  };

  const platformBadge = (platform: string) => {
    switch (platform) {
      case 'instagram':
        return <Badge className="bg-pink-500/20 text-pink-500 border-pink-500/30 gap-1"><Instagram className="w-3 h-3" />IG</Badge>;
      case 'both':
        return (
          <div className="flex gap-1">
            <Badge className="bg-blue-500/20 text-blue-500 border-blue-500/30 gap-1"><Facebook className="w-3 h-3" />FB</Badge>
            <Badge className="bg-pink-500/20 text-pink-500 border-pink-500/30 gap-1"><Instagram className="w-3 h-3" />IG</Badge>
          </div>
        );
      default:
        return <Badge className="bg-blue-500/20 text-blue-500 border-blue-500/30 gap-1"><Facebook className="w-3 h-3" />FB</Badge>;
    }
  };

  if (!selectedCompany) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground py-12">
        Select a company to manage content scheduling.
      </div>
    );
  }

  const minDate = new Date(Date.now() + 11 * 60 * 1000);
  const minDateStr = minDate.toISOString().split('T')[0];

  // Check if selected page has IG configured
  const selectedPage = pages?.find(p => p.page_id === selectedPageId);
  const hasIgConfigured = !!selectedPage?.ig_user_id;

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* Compose Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="w-5 h-5" />
            Schedule a Social Post
          </CardTitle>
          <CardDescription>
            Write your post, pick a date & time, and schedule it to Facebook, Instagram, or both.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Page selector */}
          <div className="space-y-2">
            <Label>Page / Account</Label>
            <Select value={selectedPageId} onValueChange={setSelectedPageId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a page..." />
              </SelectTrigger>
              <SelectContent>
                {pages?.map((page) => (
                  <SelectItem key={page.id} value={page.page_id}>
                    {page.platform} — {page.page_id} {page.ig_user_id ? '(+ IG)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Platform Selector */}
          <div className="space-y-2">
            <Label>Target Platform</Label>
            <ToggleGroup
              type="single"
              value={targetPlatform}
              onValueChange={(val) => {
                if (val) setTargetPlatform(val as 'facebook' | 'instagram' | 'both');
              }}
              className="justify-start"
            >
              <ToggleGroupItem value="facebook" className="gap-1.5 data-[state=on]:bg-blue-500/20 data-[state=on]:text-blue-600">
                <Facebook className="h-4 w-4" />
                Facebook
              </ToggleGroupItem>
              <ToggleGroupItem 
                value="instagram" 
                disabled={!hasIgConfigured}
                className="gap-1.5 data-[state=on]:bg-pink-500/20 data-[state=on]:text-pink-600"
              >
                <Instagram className="h-4 w-4" />
                Instagram
              </ToggleGroupItem>
              <ToggleGroupItem 
                value="both" 
                disabled={!hasIgConfigured}
                className="gap-1.5 data-[state=on]:bg-purple-500/20 data-[state=on]:text-purple-600"
              >
                Both
              </ToggleGroupItem>
            </ToggleGroup>
            {!hasIgConfigured && selectedPageId && (
              <p className="text-xs text-muted-foreground">Instagram is not configured for this page. Add an IG Business Account ID in Meta Integrations.</p>
            )}
            {(targetPlatform === 'instagram' || targetPlatform === 'both') && !imageUrl && (
              <p className="text-xs text-amber-600 dark:text-amber-400">⚠️ Instagram requires an image. Please attach one below.</p>
            )}
          </div>

          {/* Content */}
          <div className="space-y-2">
            <Label>Post Content</Label>
            <Textarea
              placeholder="Write your post here..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">{content.length} characters</p>
          </div>

          {/* Image attachment */}
          {imageUrl ? (
            <div className="space-y-2">
              <Label>Attached Image</Label>
              <div className="relative inline-block">
                <img
                  src={imageUrl}
                  alt="Attached"
                  className="w-32 h-32 object-cover rounded-lg border border-border"
                />
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
                  onClick={() => setImageUrl('')}
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ) : (
            <Popover open={imagePickerOpen} onOpenChange={setImagePickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <ImagePlus className="w-4 h-4" />
                  Attach Image
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-96 p-0" align="start">
                <Tabs defaultValue="generated" className="w-full">
                  <TabsList className="w-full rounded-none border-b">
                    <TabsTrigger value="generated" className="flex-1">Generated Images</TabsTrigger>
                    <TabsTrigger value="upload" className="flex-1">Upload</TabsTrigger>
                  </TabsList>
                  <TabsContent value="generated" className="p-3 m-0">
                    {!generatedImages?.length ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No approved generated images yet.
                      </p>
                    ) : (
                      <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                        {generatedImages.map((img) => (
                          <button
                            key={img.id}
                            className="relative group rounded-md overflow-hidden border border-border hover:border-primary transition-colors"
                            onClick={() => {
                              setImageUrl(img.image_url);
                              setImagePickerOpen(false);
                            }}
                          >
                            <img
                              src={img.image_url}
                              alt={img.prompt}
                              className="w-full h-20 object-cover"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </TabsContent>
                  <TabsContent value="upload" className="p-3 m-0">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleImageUpload(file);
                      }}
                    />
                    <Button
                      variant="outline"
                      className="w-full gap-2"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploading ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</>
                      ) : (
                        <><Upload className="w-4 h-4" /> Choose Image</>
                      )}
                    </Button>
                  </TabsContent>
                </Tabs>
              </PopoverContent>
            </Popover>
          )}

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4" /> Date
              </Label>
              <Input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                min={minDateStr}
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Clock className="w-4 h-4" /> Time
              </Label>
              <Input
                type="time"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Meta requires the scheduled time to be between 10 minutes and 75 days from now.
          </p>

          <Button
            onClick={() => scheduleMutation.mutate()}
            disabled={scheduleMutation.isPending || !content.trim() || !scheduledDate || !scheduledTime || !selectedPageId}
            className="w-full"
          >
            {scheduleMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Scheduling...</>
            ) : (
              <><Send className="w-4 h-4 mr-2" /> Schedule Post</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Upcoming Posts */}
      <Card>
        <CardHeader>
          <CardTitle>Scheduled Posts</CardTitle>
          <CardDescription>All upcoming and past scheduled posts for this company.</CardDescription>
        </CardHeader>
        <CardContent>
          {postsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : !posts?.length ? (
            <p className="text-center text-muted-foreground py-8">No scheduled posts yet.</p>
          ) : (
            <div className="space-y-3">
              {posts.map((post: any) => (
                <div
                  key={post.id}
                  className="flex items-start justify-between gap-4 p-4 rounded-lg border border-border bg-muted/30"
                >
                  {post.image_url && (
                    <img
                      src={post.image_url}
                      alt=""
                      className="w-14 h-14 rounded-md object-cover flex-shrink-0 border border-border"
                    />
                  )}
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm line-clamp-2">{post.content}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {format(new Date(post.scheduled_time), 'MMM d, yyyy')}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {format(new Date(post.scheduled_time), 'HH:mm')}
                      </span>
                      {platformBadge(post.target_platform || 'facebook')}
                    </div>
                    {post.error_message && (
                      <p className="text-xs text-destructive">{post.error_message}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {statusBadge(post.status)}
                    {(post.status === 'draft' || post.status === 'failed') && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive/70 hover:text-destructive"
                        onClick={() => deleteMutation.mutate(post.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
