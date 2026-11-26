import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle2, Facebook, Instagram, Linkedin, Music2, Loader2, ExternalLink } from 'lucide-react';
import type { CallA2UIFn, StudioConnections } from './types';

interface ConnectHubSurfaceProps {
  token: string;
  companyId: string;
  companyName: string;
  connections: StudioConnections;
  initialMetaCode?: string | null;
  initialMetaError?: string | null;
  onClearMetaParams: () => void;
  callA2UI: CallA2UIFn;
  onRefresh: () => Promise<void>;
}

interface DiscoveredPage {
  id: string;
  name: string;
  picture_url: string | null;
  has_instagram: boolean;
}

export function ConnectHubSurface({
  token,
  companyId,
  companyName,
  connections,
  initialMetaCode,
  initialMetaError,
  onClearMetaParams,
  callA2UI,
  onRefresh,
}: ConnectHubSurfaceProps) {
  const [fbBusy, setFbBusy] = useState(false);
  const [socialBusy, setSocialBusy] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pages, setPages] = useState<DiscoveredPage[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);

  const exchangeMetaCode = useCallback(
    async (code: string) => {
      setFbBusy(true);
      try {
        const redirectUri = `${window.location.origin}/auth/meta/callback`;
        const { data, error } = await supabase.functions.invoke('meta-oauth-exchange', {
          body: {
            code,
            redirect_uri: redirectUri,
            company_id: companyId,
            a2ui_token: token,
          },
        });
        if (error || data?.error) {
          throw new Error(data?.error || error?.message || 'Facebook connection failed');
        }
        const found: DiscoveredPage[] = Array.isArray(data?.pages) ? data.pages : [];
        setSessionId(data.session_id);
        setPages(found);
        setSelectedIds(found.map((p) => p.id));
        setPickerOpen(true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Meta login exchange failed');
      } finally {
        setFbBusy(false);
      }
    },
    [companyId, token]
  );

  useEffect(() => {
    if (initialMetaError) {
      toast.error(`Facebook connection error: ${initialMetaError}`);
      onClearMetaParams();
      return;
    }
    if (initialMetaCode) {
      onClearMetaParams();
      void exchangeMetaCode(initialMetaCode);
    }
  }, [initialMetaCode, initialMetaError, exchangeMetaCode, onClearMetaParams]);

  const startFacebookConnect = () => {
    if (!connections.meta_app_id) {
      toast.error('Meta App ID is not configured yet.');
      return;
    }
    setFbBusy(true);
    const redirectUri = `${window.location.origin}/auth/meta/callback`;
    const nonce = crypto.randomUUID();
    const state = `a2ui:${token}:${nonce}`;

    const url = new URL('https://www.facebook.com/v19.0/dialog/oauth');
    url.searchParams.set('client_id', connections.meta_app_id);
    if (connections.meta_config_id) url.searchParams.set('config_id', connections.meta_config_id);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set(
      'scope',
      'pages_show_list,pages_manage_metadata,pages_read_engagement,pages_messaging,' +
        'pages_manage_posts,instagram_basic,instagram_manage_messages,' +
        'instagram_manage_comments,instagram_content_publish,business_management'
    );

    const popup = window.open(url.toString(), 'meta-oauth', 'width=600,height=720,menubar=no,toolbar=no,location=no');
    if (!popup) {
      // Mobile WhatsApp in-app browsers often block popups — navigate directly and return via /auth/meta/callback
      window.location.href = url.toString();
      return;
    }

    let settled = false;
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      if (!ev.data || ev.data.source !== 'meta-oauth' || settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      window.clearInterval(closedPoll);
      if (ev.data.error) {
        setFbBusy(false);
        toast.error(`Facebook login failed: ${ev.data.error}`);
        return;
      }
      if (ev.data.code) {
        void exchangeMetaCode(String(ev.data.code));
      } else {
        setFbBusy(false);
      }
    };

    const closedPoll = window.setInterval(() => {
      if (popup.closed && !settled) {
        settled = true;
        window.removeEventListener('message', onMessage);
        window.clearInterval(closedPoll);
        setFbBusy(false);
      }
    }, 600);

    window.addEventListener('message', onMessage);
  };

  const confirmPages = async () => {
    if (!sessionId || selectedIds.length === 0) return;
    setConfirming(true);
    try {
      const { data, error } = await supabase.functions.invoke('meta-oauth-connect-pages', {
        body: {
          session_id: sessionId,
          page_ids: selectedIds,
          a2ui_token: token,
        },
      });
      if (error || data?.error) {
        throw new Error(data?.error || error?.message || 'Failed to save selected pages');
      }
      setPickerOpen(false);
      toast.success(`Connected to ${companyName}! Check WhatsApp for confirmation.`);
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setConfirming(false);
    }
  };

  const startSocialConnect = async (platform: 'tiktok' | 'linkedin_pages' | 'linkedin') => {
    setSocialBusy(platform);
    try {
      const res = await callA2UI<{ ok: boolean; authorize_url: string }>('start_social_connect', { platform });
      if (res.authorize_url) {
        window.location.href = res.authorize_url;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start connection');
      setSocialBusy(null);
    }
  };

  const metaConnected = connections.meta.length > 0;
  const igLinked = connections.meta.some((m) => Boolean(m.ig_user_id));

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-blue-500/10 text-blue-600 flex items-center justify-center shrink-0">
              <Facebook className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm">Facebook & Instagram</span>
                {metaConnected ? (
                  <Badge className="bg-emerald-600 text-white text-[11px] gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Connected
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[11px]">Not connected</Badge>
                )}
              </div>
              {metaConnected ? (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {connections.meta.map((m) => m.page_name || m.page_id).join(', ')}
                  {igLinked ? ' (+ Instagram)' : ''}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-0.5">
                  1-tap Facebook Login links both your Facebook Page and Instagram Business account.
                </p>
              )}
            </div>
          </div>
          <Button size="sm" variant={metaConnected ? 'outline' : 'default'} onClick={startFacebookConnect} disabled={fbBusy}>
            {fbBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : metaConnected ? 'Reconnect' : 'Connect'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-pink-500/10 text-pink-600 flex items-center justify-center shrink-0">
              <Music2 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">TikTok</span>
                {connections.tiktok ? (
                  <Badge className="bg-emerald-600 text-white text-[11px] gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Connected
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[11px]">Optional</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {connections.tiktok ? connections.tiktok.account_name || 'Connected' : 'Post vertical Seedance AI Reels directly to TikTok.'}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant={connections.tiktok ? 'outline' : 'secondary'}
            disabled={socialBusy === 'tiktok'}
            onClick={() => startSocialConnect('tiktok')}
            className="gap-1"
          >
            {socialBusy === 'tiktok' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
            {connections.tiktok ? 'Reconnect' : 'Connect'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-sky-500/10 text-sky-600 flex items-center justify-center shrink-0">
              <Linkedin className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">LinkedIn Company Page</span>
                {connections.linkedin ? (
                  <Badge className="bg-emerald-600 text-white text-[11px] gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Connected
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[11px]">Optional</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {connections.linkedin ? connections.linkedin.account_name || 'Connected' : 'Publish B2B updates & thought leadership.'}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant={connections.linkedin ? 'outline' : 'secondary'}
            disabled={socialBusy === 'linkedin_pages'}
            onClick={() => startSocialConnect('linkedin_pages')}
            className="gap-1"
          >
            {socialBusy === 'linkedin_pages' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
            {connections.linkedin ? 'Reconnect' : 'Connect'}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose Facebook Page(s) for {companyName}</DialogTitle>
            <DialogDescription>Select which Page and linked Instagram account Omanut should manage.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2.5 max-h-72 overflow-y-auto py-1">
            {pages.map((p) => {
              const checked = selectedIds.includes(p.id);
              return (
                <label
                  key={p.id}
                  className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(val) =>
                      setSelectedIds((prev) =>
                        val ? [...prev, p.id] : prev.filter((id) => id !== p.id)
                      )
                    }
                  />
                  {p.picture_url && (
                    <img src={p.picture_url} alt="" className="w-9 h-9 rounded-full object-cover" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      {p.has_instagram ? (
                        <>
                          <Instagram className="w-3 h-3 text-pink-500" /> Instagram Business linked
                        </>
                      ) : (
                        'Facebook Page only'
                      )}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
          <DialogFooter>
            <Button onClick={confirmPages} disabled={confirming || selectedIds.length === 0} className="w-full">
              {confirming ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Confirm & Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
