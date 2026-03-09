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
import { Calendar, Clock, Send, Loader2, AlertCircle, CheckCircle2, FileText, Trash2, ImagePlus, X, Upload, Facebook, Instagram, Sparkles, Eye, Pencil, Check, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

export const ContentSchedulerPanel = () => {
  const { selectedCompany } = useCompany();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Compose state
  const [content, setContent] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [selectedPageId, setSelectedPageId] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [targetPlatform, setTargetPlatform] = useState<'facebook' | 'instagram' | 'both'>('facebook');
  const [publishMode, setPublishMode] = useState<'schedule' | 'now'>('schedule');

  // Editing state (shared for approval queue and all posts)
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editCaption, setEditCaption] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editPopoverOpen, setEditPopoverOpen] = useState(false);

  // Fetch meta credentials
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

  // Fetch approved generated images
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

  // Fetch all scheduled posts
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

  const pendingPosts = posts?.filter((p: any) => p.status === 'pending_approval') || [];
  const allPosts = posts?.filter((p: any) => p.status !== 'pending_approval') || [];

  // Upload image
  const handleImageUpload = async (file: File) => {
    if (!selectedCompany) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `scheduled-posts/${selectedCompany.id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from('company-media').upload(path, file, { upsert: false });
      if (error) throw error;
      const { data: publicData } = supabase.storage.from('company-media').getPublicUrl(path);
      setImageUrl(publicData.publicUrl);
      setImagePickerOpen(false);
      toast.success('Image uploaded');
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  // Schedule/publish mutation
  const scheduleMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCompany) throw new Error('No company selected');
      if (!content.trim()) throw new Error('Post content is required');
      if (!selectedPageId) throw new Error('Select a page');
      if (publishMode === 'schedule' && (!scheduledDate || !scheduledTime)) throw new Error('Date and time are required');
      if ((targetPlatform === 'instagram' || targetPlatform === 'both') && !imageUrl) throw new Error('Instagram posts require an image.');

      const scheduledTimeISO = publishMode === 'now'
        ? new Date().toISOString()
        : new Date(`${scheduledDate}T${scheduledTime}`).toISOString();

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: post, error: insertError } = await supabase
        .from('scheduled_posts')
        .insert({
          company_id: selectedCompany.id, page_id: selectedPageId, content: content.trim(),
          scheduled_time: scheduledTimeISO, status: 'draft', created_by: user.id,
          image_url: imageUrl || null, target_platform: targetPlatform,
        })
        .select('id').single();
      if (insertError) throw insertError;

      if (publishMode === 'now') {
        // Publish immediately via publish-meta-post
        const { data: result, error: fnError } = await supabase.functions.invoke('publish-meta-post', { body: { post_id: post.id } });
        if (fnError) throw new Error(typeof fnError === 'object' && fnError.message ? fnError.message : String(fnError));
        if (result?.error) throw new Error(result.error);
        return result;
      } else {
        // Set status to approved — cron-publisher will handle publishing at scheduled_time
        const { error: approveError } = await supabase.from('scheduled_posts').update({
          status: 'approved', updated_at: new Date().toISOString(),
        }).eq('id', post.id);
        if (approveError) throw approveError;
        return { success: true };
      }
    },
    onSuccess: () => {
      const label = targetPlatform === 'both' ? 'Facebook + Instagram' : targetPlatform === 'instagram' ? 'Instagram' : 'Facebook';
      toast.success(`Post ${publishMode === 'now' ? 'published' : 'scheduled'} on ${label}!`);
      setContent(''); setScheduledDate(''); setScheduledTime(''); setImageUrl('');
      queryClient.invalidateQueries({ queryKey: ['scheduled-posts'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Delete post
  const deleteMutation = useMutation({
    mutationFn: async (postId: string) => {
      const { error } = await supabase.from('scheduled_posts').delete().eq('id', postId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Post deleted'); queryClient.invalidateQueries({ queryKey: ['scheduled-posts'] }); },
    onError: (error: Error) => toast.error(error.message),
  });

  // Generate AI content
  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCompany) throw new Error('No company selected');
      const { data, error } = await supabase.functions.invoke('auto-content-creator', {
        body: { company_id: selectedCompany.id },
      });
      if (error) throw new Error(typeof error === 'object' && error.message ? error.message : String(error));
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(data?.message || 'AI content generated! Check the Approval Queue.');
      queryClient.invalidateQueries({ queryKey: ['scheduled-posts'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Approve post
  const approveMutation = useMutation({
    mutationFn: async (postId: string) => {
      // If editing, save edits first
      if (editingPostId === postId) {
        const updates: any = { content: editCaption };
        if (editDate && editTime) {
          updates.scheduled_time = new Date(`${editDate}T${editTime}`).toISOString();
        }
        const { error: updateError } = await supabase.from('scheduled_posts').update(updates).eq('id', postId);
        if (updateError) throw updateError;
      }

      // Set status to approved — cron-publisher will publish at scheduled_time
      const { error } = await supabase.from('scheduled_posts').update({
        status: 'approved', updated_at: new Date().toISOString(),
      }).eq('id', postId);
      if (error) throw error;
      return { success: true };
    },
    onSuccess: () => {
      toast.success('Post approved! It will be published at the scheduled time.');
      setEditingPostId(null);
      queryClient.invalidateQueries({ queryKey: ['scheduled-posts'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Save edits mutation (for All Posts tab)
  const saveEditMutation = useMutation({
    mutationFn: async (postId: string) => {
      const updates: any = { content: editCaption, updated_at: new Date().toISOString() };
      if (editDate && editTime) {
        updates.scheduled_time = new Date(`${editDate}T${editTime}`).toISOString();
      }
      const { error } = await supabase.from('scheduled_posts').update(updates).eq('id', postId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Post updated');
      setEditingPostId(null);
      setEditPopoverOpen(false);
      queryClient.invalidateQueries({ queryKey: ['scheduled-posts'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Reject post
  const rejectMutation = useMutation({
    mutationFn: async (postId: string) => {
      const { error } = await supabase.from('scheduled_posts').update({
        status: 'failed', error_message: 'Rejected by user', updated_at: new Date().toISOString(),
      }).eq('id', postId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Post rejected');
      queryClient.invalidateQueries({ queryKey: ['scheduled-posts'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const statusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30"><CheckCircle2 className="w-3 h-3 mr-1" />Approved</Badge>;
      case 'scheduled':
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30"><Clock className="w-3 h-3 mr-1" />Scheduled</Badge>;
      case 'published':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle2 className="w-3 h-3 mr-1" />Published</Badge>;
      case 'failed':
        return <Badge className="bg-destructive/20 text-destructive border-destructive/30"><AlertCircle className="w-3 h-3 mr-1" />Failed</Badge>;
      case 'pending_approval':
        return <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30"><Eye className="w-3 h-3 mr-1" />Pending Review</Badge>;
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
  const selectedPage = pages?.find(p => p.page_id === selectedPageId);
  const hasIgConfigured = !!selectedPage?.ig_user_id;

  const startEditing = (post: any) => {
    setEditingPostId(post.id);
    setEditCaption(post.content);
    const dt = new Date(post.scheduled_time);
    setEditDate(dt.toISOString().split('T')[0]);
    setEditTime(dt.toTimeString().substring(0, 5));
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* Generate AI Content Button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Content Scheduler</h2>
          <p className="text-sm text-muted-foreground">Create, review, and schedule social media posts.</p>
        </div>
        <Button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          className="gap-2"
          variant="outline"
        >
          {generateMutation.isPending ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
          ) : (
            <><Sparkles className="w-4 h-4" /> AI Generate Content</>
          )}
        </Button>
      </div>

      <Tabs defaultValue="compose" className="w-full">
        <TabsList className="w-full">
          <TabsTrigger value="compose" className="flex-1">Compose</TabsTrigger>
          <TabsTrigger value="approval" className="flex-1">
            Approval Queue
            {pendingPosts.length > 0 && (
              <Badge className="ml-2 bg-amber-500/20 text-amber-500 border-amber-500/30 text-xs px-1.5 py-0">
                {pendingPosts.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="all" className="flex-1">All Posts</TabsTrigger>
        </TabsList>

        {/* COMPOSE TAB */}
        <TabsContent value="compose">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="w-5 h-5" />
                {publishMode === 'now' ? 'Publish a Social Post' : 'Schedule a Social Post'}
              </CardTitle>
              <CardDescription>
                {publishMode === 'now'
                  ? 'Write your post and publish it immediately.'
                  : 'Write your post, pick a date & time, and schedule it.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Publish Mode Toggle */}
              <div className="space-y-2">
                <Label>Publish Mode</Label>
                <ToggleGroup type="single" value={publishMode} onValueChange={(val) => { if (val) setPublishMode(val as 'schedule' | 'now'); }} className="justify-start">
                  <ToggleGroupItem value="schedule" className="gap-1.5 data-[state=on]:bg-primary/20 data-[state=on]:text-primary"><Clock className="h-4 w-4" />Schedule</ToggleGroupItem>
                  <ToggleGroupItem value="now" className="gap-1.5 data-[state=on]:bg-primary/20 data-[state=on]:text-primary"><Send className="h-4 w-4" />Publish Now</ToggleGroupItem>
                </ToggleGroup>
              </div>

              {/* Page selector */}
              <div className="space-y-2">
                <Label>Page / Account</Label>
                <Select value={selectedPageId} onValueChange={setSelectedPageId}>
                  <SelectTrigger><SelectValue placeholder="Select a page..." /></SelectTrigger>
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
                <ToggleGroup type="single" value={targetPlatform} onValueChange={(val) => { if (val) setTargetPlatform(val as any); }} className="justify-start">
                  <ToggleGroupItem value="facebook" className="gap-1.5 data-[state=on]:bg-blue-500/20 data-[state=on]:text-blue-600"><Facebook className="h-4 w-4" />Facebook</ToggleGroupItem>
                  <ToggleGroupItem value="instagram" disabled={!hasIgConfigured} className="gap-1.5 data-[state=on]:bg-pink-500/20 data-[state=on]:text-pink-600"><Instagram className="h-4 w-4" />Instagram</ToggleGroupItem>
                  <ToggleGroupItem value="both" disabled={!hasIgConfigured} className="gap-1.5 data-[state=on]:bg-purple-500/20 data-[state=on]:text-purple-600">Both</ToggleGroupItem>
                </ToggleGroup>
                {!hasIgConfigured && selectedPageId && <p className="text-xs text-muted-foreground">Instagram not configured for this page.</p>}
                {(targetPlatform === 'instagram' || targetPlatform === 'both') && !imageUrl && <p className="text-xs text-amber-600 dark:text-amber-400">⚠️ Instagram requires an image.</p>}
              </div>

              {/* Content */}
              <div className="space-y-2">
                <Label>Post Content</Label>
                <Textarea placeholder="Write your post here..." value={content} onChange={(e) => setContent(e.target.value)} rows={5} className="resize-none" />
                <p className="text-xs text-muted-foreground">{content.length} characters</p>
              </div>

              {/* Image attachment */}
              {imageUrl ? (
                <div className="space-y-2">
                  <Label>Attached Image</Label>
                  <div className="relative inline-block">
                    <img src={imageUrl} alt="Attached" className="w-32 h-32 object-cover rounded-lg border border-border" />
                    <Button variant="destructive" size="icon" className="absolute -top-2 -right-2 h-6 w-6 rounded-full" onClick={() => setImageUrl('')}><X className="w-3 h-3" /></Button>
                  </div>
                </div>
              ) : (
                <Popover open={imagePickerOpen} onOpenChange={setImagePickerOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2"><ImagePlus className="w-4 h-4" />Attach Image</Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-96 p-0" align="start">
                    <Tabs defaultValue="generated" className="w-full">
                      <TabsList className="w-full rounded-none border-b">
                        <TabsTrigger value="generated" className="flex-1">Generated Images</TabsTrigger>
                        <TabsTrigger value="upload" className="flex-1">Upload</TabsTrigger>
                      </TabsList>
                      <TabsContent value="generated" className="p-3 m-0">
                        {!generatedImages?.length ? (
                          <p className="text-sm text-muted-foreground text-center py-4">No approved generated images yet.</p>
                        ) : (
                          <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                            {generatedImages.map((img) => (
                              <button key={img.id} className="relative group rounded-md overflow-hidden border border-border hover:border-primary transition-colors" onClick={() => { setImageUrl(img.image_url); setImagePickerOpen(false); }}>
                                <img src={img.image_url} alt={img.prompt} className="w-full h-20 object-cover" />
                              </button>
                            ))}
                          </div>
                        )}
                      </TabsContent>
                      <TabsContent value="upload" className="p-3 m-0">
                        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleImageUpload(file); }} />
                        <Button variant="outline" className="w-full gap-2" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                          {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</> : <><Upload className="w-4 h-4" /> Choose Image</>}
                        </Button>
                      </TabsContent>
                    </Tabs>
                  </PopoverContent>
                </Popover>
              )}

              {/* Date & Time */}
              {publishMode === 'schedule' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5"><Calendar className="w-4 h-4" /> Date</Label>
                      <Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} min={minDateStr} />
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5"><Clock className="w-4 h-4" /> Time</Label>
                      <Input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">Meta requires the scheduled time to be between 10 minutes and 75 days from now.</p>
                </>
              )}

              <Button onClick={() => scheduleMutation.mutate()} disabled={scheduleMutation.isPending || !content.trim() || !selectedPageId || (publishMode === 'schedule' && (!scheduledDate || !scheduledTime))} className="w-full">
                {scheduleMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {publishMode === 'now' ? 'Publishing...' : 'Scheduling...'}</> : <><Send className="w-4 h-4 mr-2" /> {publishMode === 'now' ? 'Publish Now' : 'Schedule Post'}</>}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* APPROVAL QUEUE TAB */}
        <TabsContent value="approval">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="w-5 h-5" />
                Approval Queue
              </CardTitle>
              <CardDescription>AI-generated posts awaiting your review. Edit, approve, or reject.</CardDescription>
            </CardHeader>
            <CardContent>
              {postsLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
              ) : !pendingPosts.length ? (
                <div className="text-center py-8 space-y-3">
                  <p className="text-muted-foreground">No posts awaiting approval.</p>
                  <Button variant="outline" className="gap-2" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
                    {generateMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</> : <><Sparkles className="w-4 h-4" /> Generate AI Content</>}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {pendingPosts.map((post: any) => {
                    const isEditing = editingPostId === post.id;
                    return (
                      <div key={post.id} className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/5 space-y-3">
                        <div className="flex items-start gap-4">
                          {post.image_url && (
                            <img src={post.image_url} alt="" className="w-24 h-24 rounded-lg object-cover flex-shrink-0 border border-border" />
                          )}
                          <div className="flex-1 min-w-0 space-y-2">
                            {isEditing ? (
                              <Textarea value={editCaption} onChange={(e) => setEditCaption(e.target.value)} rows={4} className="resize-none" />
                            ) : (
                              <p className="text-sm">{post.content}</p>
                            )}
                            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                              {isEditing ? (
                                <div className="flex gap-2">
                                  <Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="h-7 text-xs w-36" />
                                  <Input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)} className="h-7 text-xs w-28" />
                                </div>
                              ) : (
                                <>
                                  <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{format(new Date(post.scheduled_time), 'MMM d, yyyy')}</span>
                                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{format(new Date(post.scheduled_time), 'HH:mm')}</span>
                                </>
                              )}
                              {platformBadge(post.target_platform || 'facebook')}
                              {statusBadge(post.status)}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 justify-end">
                          {isEditing ? (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => setEditingPostId(null)}><X className="w-4 h-4 mr-1" />Cancel</Button>
                              <Button size="sm" className="gap-1 bg-green-600 hover:bg-green-700" onClick={() => approveMutation.mutate(post.id)} disabled={approveMutation.isPending}>
                                {approveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4" />Save & Approve</>}
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button size="sm" variant="ghost" className="gap-1 text-destructive hover:text-destructive" onClick={() => rejectMutation.mutate(post.id)} disabled={rejectMutation.isPending}>
                                <XCircle className="w-4 h-4" />Reject
                              </Button>
                              <Button size="sm" variant="outline" className="gap-1" onClick={() => startEditing(post)}>
                                <Pencil className="w-4 h-4" />Edit
                              </Button>
                              <Button size="sm" className="gap-1 bg-green-600 hover:bg-green-700" onClick={() => approveMutation.mutate(post.id)} disabled={approveMutation.isPending}>
                                {approveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4" />Approve</>}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ALL POSTS TAB */}
        <TabsContent value="all">
          <Card>
            <CardHeader>
              <CardTitle>All Posts</CardTitle>
              <CardDescription>All scheduled, published, and past posts.</CardDescription>
            </CardHeader>
            <CardContent>
              {postsLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
              ) : !allPosts.length ? (
                <p className="text-center text-muted-foreground py-8">No posts yet.</p>
              ) : (
                <div className="space-y-3">
                  {allPosts.map((post: any) => {
                    const isEditable = ['draft', 'approved', 'scheduled'].includes(post.status);
                    const isEditingThis = editingPostId === post.id && editPopoverOpen;
                    
                    return (
                      <div key={post.id} className="relative flex items-start justify-between gap-4 p-4 rounded-lg border border-border bg-muted/30 group">
                        {post.image_url && <img src={post.image_url} alt="" className="w-14 h-14 rounded-md object-cover flex-shrink-0 border border-border" />}
                        <div className="flex-1 min-w-0 space-y-1">
                          <p className="text-sm line-clamp-2">{post.content}</p>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{format(new Date(post.scheduled_time), 'MMM d, yyyy')}</span>
                            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{format(new Date(post.scheduled_time), 'HH:mm')}</span>
                            {platformBadge(post.target_platform || 'facebook')}
                          </div>
                          {post.error_message && <p className="text-xs text-destructive">{post.error_message}</p>}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {statusBadge(post.status)}
                          {isEditable && (
                            <Popover open={isEditingThis} onOpenChange={(open) => {
                              if (open) {
                                startEditing(post);
                                setEditPopoverOpen(true);
                              } else {
                                setEditingPostId(null);
                                setEditPopoverOpen(false);
                              }
                            }}>
                              <PopoverTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Pencil className="w-4 h-4" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-80 p-0" align="end" side="left">
                                <div className="p-3 border-b border-border bg-muted/50">
                                  <p className="text-sm font-medium">Edit Post</p>
                                </div>
                                <div className="p-3 space-y-3">
                                  <Textarea 
                                    value={editCaption} 
                                    onChange={(e) => setEditCaption(e.target.value)} 
                                    rows={4} 
                                    className="resize-none text-sm"
                                    placeholder="Post content..."
                                  />
                                  <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-1">
                                      <Label className="text-xs">Date</Label>
                                      <Input 
                                        type="date" 
                                        value={editDate} 
                                        onChange={(e) => setEditDate(e.target.value)} 
                                        className="h-8 text-xs" 
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs">Time</Label>
                                      <Input 
                                        type="time" 
                                        value={editTime} 
                                        onChange={(e) => setEditTime(e.target.value)} 
                                        className="h-8 text-xs" 
                                      />
                                    </div>
                                  </div>
                                  <div className="flex items-center justify-end gap-2 pt-2">
                                    <Button 
                                      variant="ghost" 
                                      size="sm" 
                                      onClick={() => { setEditingPostId(null); setEditPopoverOpen(false); }}
                                    >
                                      Cancel
                                    </Button>
                                    <Button 
                                      size="sm" 
                                      onClick={() => saveEditMutation.mutate(post.id)} 
                                      disabled={saveEditMutation.isPending}
                                      className="gap-1"
                                    >
                                      {saveEditMutation.isPending ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                      ) : (
                                        <Check className="w-3 h-3" />
                                      )}
                                      Save
                                    </Button>
                                  </div>
                                </div>
                              </PopoverContent>
                            </Popover>
                          )}
                          {(post.status === 'draft' || post.status === 'failed') && (
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive/70 hover:text-destructive" onClick={() => deleteMutation.mutate(post.id)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
