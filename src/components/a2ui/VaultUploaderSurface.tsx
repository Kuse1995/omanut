import { useState, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import {
  UploadCloud,
  Image as ImageIcon,
  Film,
  Sparkles,
  CheckCircle2,
  Trash2,
  BookmarkCheck,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import type { CallA2UIFn, StudioTab, VaultAsset } from './types';

interface VaultUploaderSurfaceProps {
  vault: VaultAsset[];
  callA2UI: CallA2UIFn;
  onRefresh: () => Promise<void>;
  onSwitchTab: (tab: StudioTab) => void;
}

interface MintedUpload {
  file_name: string;
  file_path: string;
  signed_url: string;
  media_type: 'image' | 'video';
}

export function VaultUploaderSurface({
  vault,
  callA2UI,
  onRefresh,
  onSwitchTab,
}: VaultUploaderSurfaceProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [filter, setFilter] = useState<'all' | 'ready' | 'scheduled' | 'posted' | 'evergreen'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const selected = Array.from(fileList).slice(0, 20);
    setUploading(true);
    setProgress(10);

    try {
      const minted = await callA2UI<{ ok: boolean; uploads: MintedUpload[] }>('mint_upload_urls', {
        files: selected.map((f) => ({
          file_name: f.name,
          content_type: f.type || 'image/jpeg',
          file_size: f.size,
        })),
      });

      if (!minted.uploads || minted.uploads.length === 0) {
        toast.error('Please choose valid image or video files.');
        return;
      }

      const completed: Array<{
        file_path: string;
        file_name: string;
        file_type: string;
        file_size: number;
        media_type: 'image' | 'video';
      }> = [];

      for (let i = 0; i < minted.uploads.length; i++) {
        const m = minted.uploads[i];
        const file = selected.find((f) => f.name === m.file_name) || selected[i];
        const putRes = await fetch(m.signed_url, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });
        if (putRes.ok) {
          completed.push({
            file_path: m.file_path,
            file_name: file.name,
            file_type: file.type || 'image/jpeg',
            file_size: file.size,
            media_type: m.media_type,
          });
        }
        setProgress(Math.round(((i + 1) / minted.uploads.length) * 85) + 10);
      }

      if (completed.length > 0) {
        await callA2UI('complete_vault_upload', {
          uploads: completed,
          notify_whatsapp: true,
        });
        toast.success(`Uploaded ${completed.length} item(s) to your Content Vault!`);
        await onRefresh();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      setProgress(0);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const toggleEvergreen = async (asset: VaultAsset) => {
    setBusyId(asset.id);
    try {
      const nextStatus = asset.vault_status === 'evergreen' ? 'ready' : 'evergreen';
      await callA2UI('update_vault_asset', { asset_id: asset.id, vault_status: nextStatus });
      toast.success(nextStatus === 'evergreen' ? 'Marked as Evergreen (reusable)' : 'Moved back to Ready');
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  };

  const archiveAsset = async (assetId: string) => {
    setBusyId(assetId);
    try {
      await callA2UI('update_vault_asset', { asset_id: assetId, vault_status: 'archived' });
      toast.success('Removed from active Vault');
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setBusyId(null);
    }
  };

  const filtered = vault.filter((v) => (filter === 'all' ? true : v.vault_status === filter));
  const readyCount = vault.filter((v) => v.vault_status === 'ready' || v.vault_status === 'evergreen').length;

  return (
    <div className="space-y-4">
      <Card className="border-dashed border-2 border-primary/40 bg-primary/5">
        <CardContent className="p-5 text-center space-y-3">
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => handleFilesSelected(e.target.files)}
          />
          <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/15 flex items-center justify-center text-primary">
            <UploadCloud className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-semibold text-base">Upload Your Photos & Videos</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Select up to 20 items from your phone. Omanut AI automatically tags, scores & suggests captions for each.
            </p>
          </div>
          {uploading ? (
            <div className="space-y-2 max-w-xs mx-auto">
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Uploading & syncing with your Marketer... {progress}%
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button onClick={() => inputRef.current?.click()} className="gap-2">
                <UploadCloud className="w-4 h-4" />
                Choose Photos / Videos
              </Button>
              {readyCount >= 2 && (
                <Button variant="outline" onClick={() => onSwitchTab('prioritize')} className="gap-1.5">
                  Pick Which Goes First
                  <ArrowRight className="w-4 h-4" />
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {(['all', 'ready', 'evergreen', 'scheduled', 'posted'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors ${
                filter === tab
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">{filtered.length} asset(s)</span>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No content in this view yet. Upload photos or short video clips above!
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map((item) => (
            <Card key={item.id} className="overflow-hidden">
              <div className="relative aspect-video bg-muted">
                {item.media_type === 'video' ? (
                  <video src={item.url} className="w-full h-full object-cover" controls playsInline />
                ) : (
                  <img src={item.url} alt={item.file_name} className="w-full h-full object-cover" loading="lazy" />
                )}
                <div className="absolute top-2 left-2 flex gap-1.5">
                  <Badge variant="secondary" className="text-[11px] bg-background/90 backdrop-blur">
                    {item.media_type === 'video' ? <Film className="w-3 h-3 mr-1" /> : <ImageIcon className="w-3 h-3 mr-1" />}
                    {item.vault_status}
                  </Badge>
                  {typeof item.quality_score === 'number' && (
                    <Badge className="text-[11px] bg-emerald-600 text-white">
                      <Sparkles className="w-3 h-3 mr-1" />
                      {item.quality_score}/10
                    </Badge>
                  )}
                </div>
              </div>
              <CardContent className="p-3 space-y-2">
                <p className="text-xs text-foreground line-clamp-2">
                  {item.description || item.file_name}
                </p>
                {Array.isArray(item.ai_hook_suggestions) && item.ai_hook_suggestions.length > 0 && (
                  <div className="bg-muted/60 rounded-md p-2 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">AI Hook: </span>
                    {item.ai_hook_suggestions[0]}
                  </div>
                )}
                <div className="flex items-center justify-between pt-1">
                  <Button
                    size="sm"
                    variant={item.vault_status === 'evergreen' ? 'secondary' : 'ghost'}
                    disabled={busyId === item.id}
                    onClick={() => toggleEvergreen(item)}
                    className="h-7 px-2 text-xs gap-1"
                  >
                    {item.vault_status === 'evergreen' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <BookmarkCheck className="w-3.5 h-3.5" />
                    )}
                    Evergreen
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === item.id}
                    onClick={() => archiveAsset(item.id)}
                    className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
