import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Calendar, Grid3X3, CheckCircle2, Trash2, Edit2, Save, X, Loader2 } from 'lucide-react';
import type { CallA2UIFn, StudioScheduledPost } from './types';

interface CalendarGridSurfaceProps {
  posts: StudioScheduledPost[];
  callA2UI: CallA2UIFn;
  onRefresh: () => Promise<void>;
}

function toLusakaInputValue(utcIso: string): string {
  const local = new Date(Date.parse(utcIso) + 2 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function formatLusakaReadable(utcIso: string): string {
  const local = new Date(Date.parse(utcIso) + 2 * 60 * 60 * 1000);
  return `${local.toUTCString().replace(' GMT', '').slice(0, 22)} CAT`;
}

export function CalendarGridSurface({ posts, callA2UI, onRefresh }: CalendarGridSurfaceProps) {
  const [view, setView] = useState<'timeline' | 'ig_grid'>('timeline');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCaption, setEditCaption] = useState('');
  const [editTime, setEditTime] = useState('');
  const [busy, setBusy] = useState(false);

  const pendingApproval = posts.filter((p) => p.status === 'pending_approval' || p.status === 'draft');
  const gridItems = posts.filter((p) => p.image_url || (p.image_urls && p.image_urls.length > 0) || p.video_url);

  const startEdit = (post: StudioScheduledPost) => {
    setEditingId(post.id);
    setEditCaption(post.content);
    setEditTime(toLusakaInputValue(post.scheduled_time));
  };

  const saveEdit = async (postId: string, approveAlso = false) => {
    setBusy(true);
    try {
      await callA2UI('update_scheduled_post', {
        post_id: postId,
        content: editCaption,
        scheduled_time_lusaka: editTime.replace('T', ' '),
        ...(approveAlso ? { status: 'approved' } : {}),
      });
      toast.success('Updated post');
      setEditingId(null);
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const approveAll = async () => {
    setBusy(true);
    try {
      const res = await callA2UI<{ approved_count: number }>('approve_week');
      toast.success(`Approved ${res.approved_count || pendingApproval.length} post(s) & notified WhatsApp!`);
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setBusy(false);
    }
  };

  const removePost = async (postId: string) => {
    setBusy(true);
    try {
      await callA2UI('delete_scheduled_post', { post_id: postId });
      toast.success('Removed scheduled post');
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="inline-flex rounded-lg bg-muted p-1">
          <button
            type="button"
            onClick={() => setView('timeline')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium ${
              view === 'timeline' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            Schedule ({posts.length})
          </button>
          <button
            type="button"
            onClick={() => setView('ig_grid')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium ${
              view === 'ig_grid' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'
            }`}
          >
            <Grid3X3 className="w-3.5 h-3.5" />
            3×3 Feed Preview
          </button>
        </div>

        {pendingApproval.length > 0 && (
          <Button size="sm" onClick={approveAll} disabled={busy} className="gap-1.5">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            Approve All ({pendingApproval.length})
          </Button>
        )}
      </div>

      {posts.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No scheduled posts yet. Ask your Omanut Marketer on WhatsApp to plan this week!
          </CardContent>
        </Card>
      ) : view === 'ig_grid' ? (
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground mb-3">
              How your upcoming & published visuals look side-by-side on your Instagram / Facebook feed:
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {gridItems.slice(0, 9).map((post) => {
                const img = post.image_url || post.image_urls?.[0];
                return (
                  <div
                    key={post.id}
                    onClick={() => {
                      setView('timeline');
                      startEdit(post);
                    }}
                    className="relative aspect-square bg-muted rounded overflow-hidden cursor-pointer group"
                  >
                    {post.video_url && !img ? (
                      <video src={post.video_url} className="w-full h-full object-cover" muted playsInline />
                    ) : img ? (
                      <img src={img} alt="" className="w-full h-full object-cover" />
                    ) : null}
                    <div className="absolute bottom-1 left-1">
                      <Badge variant="secondary" className="text-[10px] px-1 py-0 bg-background/85">
                        {post.status}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => {
            const media = post.image_url || post.image_urls?.[0];
            const isEditing = editingId === post.id;
            return (
              <Card key={post.id}>
                <CardContent className="p-3.5 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={post.status === 'approved' ? 'default' : post.status === 'published' ? 'secondary' : 'outline'} className="text-[11px] capitalize">
                        {post.status.replace(/_/g, ' ')}
                      </Badge>
                      <Badge variant="outline" className="text-[11px] capitalize">
                        {post.target_platform}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">{formatLusakaReadable(post.scheduled_time)}</span>
                    </div>
                    {post.status !== 'published' && !isEditing && (
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(post)}>
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removePost(post.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="space-y-2 pt-1">
                      <Textarea value={editCaption} onChange={(e) => setEditCaption(e.target.value)} rows={4} className="text-xs" />
                      <Input type="datetime-local" value={editTime} onChange={(e) => setEditTime(e.target.value)} className="text-xs" />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => saveEdit(post.id, post.status !== 'approved')} disabled={busy} className="gap-1">
                          <Save className="w-3.5 h-3.5" />
                          Save & Approve
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      {post.video_url ? (
                        <video src={post.video_url} className="w-20 h-20 rounded-md object-cover shrink-0 bg-muted" muted playsInline />
                      ) : media ? (
                        <img src={media} alt="" className="w-20 h-20 rounded-md object-cover shrink-0 bg-muted" />
                      ) : null}
                      <p className="text-xs text-foreground whitespace-pre-line flex-1">{post.content}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
