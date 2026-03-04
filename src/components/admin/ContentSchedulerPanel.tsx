import { useState } from 'react';
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
import { Calendar, Clock, Send, Loader2, AlertCircle, CheckCircle2, FileText, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

export const ContentSchedulerPanel = () => {
  const { selectedCompany } = useCompany();
  const queryClient = useQueryClient();

  const [content, setContent] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [selectedPageId, setSelectedPageId] = useState('');

  // Fetch meta credentials (pages) for this company
  const { data: pages } = useQuery({
    queryKey: ['meta-pages', selectedCompany?.id],
    queryFn: async () => {
      if (!selectedCompany) return [];
      const { data, error } = await supabase
        .from('meta_credentials')
        .select('id, page_id, platform')
        .eq('company_id', selectedCompany.id);
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

  // Create draft & schedule
  const scheduleMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCompany) throw new Error('No company selected');
      if (!content.trim()) throw new Error('Post content is required');
      if (!scheduledDate || !scheduledTime) throw new Error('Date and time are required');
      if (!selectedPageId) throw new Error('Select a Facebook page');

      const scheduledTimeISO = new Date(`${scheduledDate}T${scheduledTime}`).toISOString();

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Insert draft
      const { data: post, error: insertError } = await supabase
        .from('scheduled_posts')
        .insert({
          company_id: selectedCompany.id,
          page_id: selectedPageId,
          content: content.trim(),
          scheduled_time: scheduledTimeISO,
          status: 'draft',
          created_by: user.id,
        })
        .select('id')
        .single();

      if (insertError) throw insertError;

      // Call edge function to schedule on Meta
      const { data: result, error: fnError } = await supabase.functions.invoke('schedule-meta-post', {
        body: { post_id: post.id },
      });

      if (fnError) throw fnError;
      if (result?.error) throw new Error(result.error);

      return result;
    },
    onSuccess: () => {
      toast.success('Post scheduled on Facebook!');
      setContent('');
      setScheduledDate('');
      setScheduledTime('');
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

  if (!selectedCompany) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground py-12">
        Select a company to manage content scheduling.
      </div>
    );
  }

  // Minimum datetime: 11 min from now (buffer)
  const minDate = new Date(Date.now() + 11 * 60 * 1000);
  const minDateStr = minDate.toISOString().split('T')[0];

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* Compose Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="w-5 h-5" />
            Schedule a Facebook Post
          </CardTitle>
          <CardDescription>
            Write your post, pick a date & time, and schedule it directly to your Facebook page via Meta's API.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Page selector */}
          <div className="space-y-2">
            <Label>Facebook Page</Label>
            <Select value={selectedPageId} onValueChange={setSelectedPageId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a page..." />
              </SelectTrigger>
              <SelectContent>
                {pages?.map((page) => (
                  <SelectItem key={page.id} value={page.page_id}>
                    {page.platform} — {page.page_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Content */}
          <div className="space-y-2">
            <Label>Post Content</Label>
            <Textarea
              placeholder="Write your Facebook post here..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">{content.length} characters</p>
          </div>

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
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm line-clamp-2">{post.content}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {format(new Date(post.scheduled_time), 'MMM d, yyyy')}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {format(new Date(post.scheduled_time), 'HH:mm')}
                      </span>
                      <span>Page: {post.page_id}</span>
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
