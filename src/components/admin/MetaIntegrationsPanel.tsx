import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { toast } from 'sonner';
import { Facebook, Instagram, Plus, Trash2, Edit2, Save, X, Eye, EyeOff, Loader2, CheckCircle2, AlertTriangle, Copy, MessageCircle } from 'lucide-react';
import { useCompany } from '@/context/CompanyContext';

interface MetaCredential {
  id: string;
  page_id: string;
  page_name: string | null;
  page_picture_url: string | null;
  access_token: string;
  platform: string;
  ai_system_prompt: string;
  ig_user_id: string | null;
  company_id: string;
  created_at: string;
  health_status: string;
  last_verified_at: string | null;
  connected_via: string;
}

// Manual OAuth flow: no Facebook JS SDK. We open Meta's dialog/oauth in a popup
// and receive the authorization code on our /auth/meta/callback page, which
// posts it back via window.postMessage.


export const MetaIntegrationsPanel = () => {
  const { selectedCompany } = useCompany();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [form, setForm] = useState({
    page_id: '',
    access_token: '',
    ig_user_id: '',
    ai_system_prompt: '',
  });

  const [fbReady, setFbReady] = useState(false);
  const [fbSdkError, setFbSdkError] = useState<string | null>(null);
  const [fbConnecting, setFbConnecting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [discoveredPages, setDiscoveredPages] = useState<
    Array<{ id: string; name: string; picture_url: string | null; has_instagram: boolean }>
  >([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);

  // WhatsApp Cloud (direct Meta) state
  const [waShowForm, setWaShowForm] = useState(false);
  const [waForm, setWaForm] = useState({
    waba_id: '',
    phone_number_id: '',
    display_phone_number: '',
    business_name: '',
    access_token: '',
  });
  const [waShowToken, setWaShowToken] = useState(false);

  // Load public Meta config (App ID + Login Config ID) and the FB JS SDK
  const { data: metaConfig } = useQuery({
    queryKey: ['meta-public-config'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('meta-public-config');
      if (error) throw error;
      return data as { app_id: string | null; config_id: string | null; configured: boolean };
    },
  });

  useEffect(() => {
    if (!metaConfig?.app_id) return;
    if (window.FB) {
      setFbReady(true);
      return;
    }
    let timeoutId: number | undefined;
    let settled = false;

    window.fbAsyncInit = () => {
      try {
        window.FB!.init({
          appId: metaConfig.app_id!,
          cookie: true,
          xfbml: false,
          version: 'v19.0',
        });
        settled = true;
        if (timeoutId) window.clearTimeout(timeoutId);
        setFbReady(true);
        setFbSdkError(null);
      } catch (e) {
        console.error('[MetaPanel] FB.init failed', e);
        setFbSdkError('Facebook SDK failed to initialize. Refresh the page.');
      }
    };

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src*="connect.facebook.net"]'
    );
    if (existing) {
      // Script already present (e.g. hot reload) — just wait for init
    } else {
      const script = document.createElement('script');
      script.src = 'https://connect.facebook.net/en_US/sdk.js';
      script.async = true;
      script.defer = true;
      script.crossOrigin = 'anonymous';
      script.onerror = () => {
        console.error('[MetaPanel] Failed to load Facebook SDK script');
        setFbSdkError(
          "Couldn't load the Facebook SDK. Disable ad blockers / privacy extensions and reload."
        );
      };
      document.body.appendChild(script);
    }

    // 10s safety net — if init never fires, surface a clear error
    timeoutId = window.setTimeout(() => {
      if (!settled) {
        console.warn('[MetaPanel] FB SDK init timed out after 10s');
        setFbSdkError(
          'Facebook SDK took too long to load. Check your network or ad blockers and reload.'
        );
      }
    }, 10000);

    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [metaConfig?.app_id]);

  const { data: credentials, isLoading } = useQuery({
    queryKey: ['meta-credentials', selectedCompany?.id],
    queryFn: async () => {
      if (!selectedCompany?.id) return [];
      const { data, error } = await supabase
        .from('meta_credentials')
        .select('*')
        .eq('company_id', selectedCompany.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as MetaCredential[];
    },
    enabled: !!selectedCompany?.id,
  });

  // WhatsApp Cloud direct credentials
  const { data: waCloud, isLoading: waLoading } = useQuery({
    queryKey: ['company-whatsapp-cloud', selectedCompany?.id],
    queryFn: async () => {
      if (!selectedCompany?.id) return null;
      const { data, error } = await supabase
        .from('company_whatsapp_cloud')
        .select('*')
        .eq('company_id', selectedCompany.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!selectedCompany?.id,
  });

  const waSaveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCompany?.id) throw new Error('No company selected');
      const payload = {
        company_id: selectedCompany.id,
        waba_id: waForm.waba_id.trim(),
        phone_number_id: waForm.phone_number_id.trim(),
        display_phone_number: waForm.display_phone_number.trim(),
        business_name: waForm.business_name.trim() || null,
        access_token: waForm.access_token.trim(),
        connected_via: 'manual',
        health_status: 'pending',
        updated_at: new Date().toISOString(),
      };
      if (waCloud) {
        const { error } = await supabase
          .from('company_whatsapp_cloud')
          .update(payload)
          .eq('company_id', selectedCompany.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('company_whatsapp_cloud')
          .insert(payload);
        if (error) throw error;
      }
      // Switch the provider toggle on the company
      await supabase
        .from('companies')
        .update({ whatsapp_provider: 'meta_cloud' })
        .eq('id', selectedCompany.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-whatsapp-cloud'] });
      toast.success('WhatsApp Cloud connected. Twilio is now bypassed for this company.');
      setWaShowForm(false);
      setWaShowToken(false);
      setWaForm({ waba_id: '', phone_number_id: '', display_phone_number: '', business_name: '', access_token: '' });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const waDeleteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCompany?.id) return;
      const { error } = await supabase
        .from('company_whatsapp_cloud')
        .delete()
        .eq('company_id', selectedCompany.id);
      if (error) throw error;
      // Revert to Twilio
      await supabase
        .from('companies')
        .update({ whatsapp_provider: 'twilio' })
        .eq('id', selectedCompany.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-whatsapp-cloud'] });
      toast.success('Reverted to Twilio for this company.');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const startWaEdit = () => {
    if (waCloud) {
      setWaForm({
        waba_id: waCloud.waba_id ?? '',
        phone_number_id: waCloud.phone_number_id ?? '',
        display_phone_number: waCloud.display_phone_number ?? '',
        business_name: waCloud.business_name ?? '',
        access_token: waCloud.access_token ?? '',
      });
    }
    setWaShowForm(true);
  };

  const startFacebookConnect = useCallback(() => {
    // Hard-verify SDK + login function are actually callable.
    // fbReady can be true while window.FB.login is undefined if a privacy
    // extension blocks part of the SDK after init.
    const fb = window.FB as (typeof window.FB & { login?: unknown }) | undefined;
    if (!fbReady || !fb || typeof fb.login !== 'function' || !selectedCompany?.id) {
      console.warn('[MetaPanel] Connect clicked but not ready', {
        fbReady,
        hasFB: !!fb,
        hasLogin: typeof fb?.login,
        hasCompany: !!selectedCompany?.id,
      });
      if (!selectedCompany?.id) {
        toast.error('Pick a company first.');
      } else if (!fb || typeof fb?.login !== 'function') {
        toast.error(
          "Facebook SDK loaded incompletely — likely blocked by a privacy extension. Disable shields/ad blockers for this site, then reload.",
          { duration: 8000 }
        );
        setFbSdkError(
          'Facebook SDK is loaded but FB.login is unavailable. A browser extension (uBlock, Privacy Badger, Brave shields, etc.) is blocking part of the SDK.'
        );
      } else {
        toast.error("Facebook SDK isn't ready yet. Please wait a moment or reload.");
      }
      return;
    }
    setFbConnecting(true);

    const loginOpts: Record<string, unknown> = {
      scope:
        'pages_show_list,pages_manage_metadata,pages_read_engagement,pages_messaging,pages_manage_posts,instagram_basic,instagram_manage_messages,instagram_manage_comments,instagram_content_publish,business_management',
      return_scopes: true,
      // Facebook Login for Business REQUIRES the authorization-code flow.
      // The popup rejects response_type=token (the SDK's default) with
      // "Invalid parameter: response_type must be a valid enum".
      response_type: 'code',
    };
    if (metaConfig?.config_id) {
      loginOpts.config_id = metaConfig.config_id;
    }

    // 30s safety net — if the popup is closed/blocked and FB never calls back, free the UI
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        setFbConnecting(false);
        toast.error(
          'Facebook login window timed out. If a popup was blocked, allow popups for this site and try again.'
        );
      }
    }, 30000);

    // IMPORTANT: FB.login REJECTS async callbacks ("Expression is of type
    // asyncfunction, not function"). We MUST pass a plain function and run
    // any async work inside it without awaiting it at the top level.
    const handleFbResponse = (resp: { authResponse?: { accessToken?: string; userID?: string; code?: string }; status: string }) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      console.log('[MetaPanel] FB.login response', { status: resp.status, hasCode: Boolean(resp.authResponse?.code) });

      const code = resp.authResponse?.code;
      if (!code) {
        setFbConnecting(false);
        if (resp.status === 'not_authorized') {
          toast.error('You declined the permissions required to connect.');
        } else if (resp.status === 'unknown') {
          toast.error(
            'Facebook login was cancelled or blocked. Make sure popups are allowed and this domain is whitelisted in the Meta App.'
          );
        } else {
          toast.error('Facebook login was cancelled');
        }
        return;
      }

      // Fire-and-handle async exchange inside an IIFE so FB only sees a sync callback.
      (async () => {
        try {
          const { data, error } = await supabase.functions.invoke('meta-oauth-exchange', {
            body: {
              code,
              company_id: selectedCompany.id,
            },
          });
          if (error) throw error;
          if (!data?.pages?.length) {
            toast.error('No Facebook Pages were found on this account');
            return;
          }
          setDiscoveredPages(data.pages);
          setSessionId(data.session_id);
          setSelectedPageIds(data.pages.map((p: { id: string }) => p.id));
          setPickerOpen(true);
        } catch (err) {
          console.error('[MetaPanel] meta-oauth-exchange failed', err);
          toast.error(err instanceof Error ? err.message : 'Failed to load your Pages');
        } finally {
          setFbConnecting(false);
        }
      })();
    };

    try {
      window.FB.login(handleFbResponse, loginOpts);
    } catch (e) {
      settled = true;
      window.clearTimeout(timeoutId);
      setFbConnecting(false);
      console.error('[MetaPanel] FB.login threw', e);
      const msg = e instanceof Error ? e.message : String(e);
      // Most common reasons: SDK partially blocked, popup blocker, or third-party cookies disabled.
      toast.error(
        `Failed to open Facebook login: ${msg || 'unknown error'}. Try: (1) allow popups for this site, (2) disable ad/privacy blockers, (3) enable third-party cookies for facebook.com.`,
        { duration: 8000 }
      );
      setFbSdkError(
        'Facebook login window failed to open. This is usually caused by an ad blocker, popup blocker, or third-party cookies being disabled for facebook.com.'
      );
    }
  }, [fbReady, selectedCompany?.id, metaConfig?.config_id]);

  const confirmConnect = async () => {
    if (!sessionId || selectedPageIds.length === 0) return;
    setConfirming(true);
    try {
      const { data, error } = await supabase.functions.invoke('meta-oauth-connect-pages', {
        body: { session_id: sessionId, page_ids: selectedPageIds },
      });
      if (error) throw error;
      const ok = (data?.connected ?? []).filter((c: { error?: string }) => !c.error).length;
      const fail = (data?.connected ?? []).length - ok;
      if (ok > 0) toast.success(`${ok} page${ok > 1 ? 's' : ''} connected`);
      if (fail > 0) toast.warning(`${fail} page${fail > 1 ? 's' : ''} failed to connect`);
      queryClient.invalidateQueries({ queryKey: ['meta-credentials'] });
      setPickerOpen(false);
      setSessionId(null);
      setDiscoveredPages([]);
      setSelectedPageIds([]);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to connect pages');
    } finally {
      setConfirming(false);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const payload = {
        page_id: form.page_id,
        access_token: form.access_token,
        platform: 'facebook',
        ai_system_prompt: form.ai_system_prompt,
        ig_user_id: form.ig_user_id || null,
        connected_via: 'manual',
      };

      if (editingId) {
        const { error } = await supabase
          .from('meta_credentials')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', editingId);
        if (error) throw error;
      } else {
        if (!selectedCompany?.id) throw new Error('No company selected');
        const { error } = await supabase
          .from('meta_credentials')
          .insert({ ...payload, user_id: user.id, company_id: selectedCompany.id });
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['meta-credentials'] });
      toast.success(editingId ? 'Credential updated' : 'Credential saved');

      if (!editingId) {
        const { data: latest } = await supabase
          .from('meta_credentials')
          .select('id')
          .eq('company_id', selectedCompany!.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (latest) {
          await supabase.functions.invoke('subscribe-meta-page', {
            body: { credential_id: latest.id },
          });
        }
      } else {
        await supabase.functions.invoke('subscribe-meta-page', {
          body: { credential_id: editingId },
        });
      }
      resetForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('meta_credentials').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meta-credentials'] });
      toast.success('Credential deleted');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resetForm = () => {
    setForm({ page_id: '', access_token: '', ig_user_id: '', ai_system_prompt: '' });
    setEditingId(null);
    setShowForm(false);
    setShowToken(false);
  };

  const startEdit = (cred: MetaCredential) => {
    setForm({
      page_id: cred.page_id,
      access_token: cred.access_token,
      ig_user_id: cred.ig_user_id || '',
      ai_system_prompt: cred.ai_system_prompt || '',
    });
    setEditingId(cred.id);
    setShowForm(true);
  };

  const togglePage = (id: string) => {
    setSelectedPageIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const healthBadge = (status: string) => {
    if (status === 'healthy')
      return (
        <Badge variant="secondary" className="text-xs gap-1">
          <CheckCircle2 className="w-3 h-3 text-green-500" /> Live
        </Badge>
      );
    if (status === 'expiring' || status === 'unhealthy')
      return (
        <Badge variant="secondary" className="text-xs gap-1">
          <AlertTriangle className="w-3 h-3 text-yellow-500" /> Check
        </Badge>
      );
    return null;
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Meta Integrations</h2>
          <p className="text-muted-foreground text-sm">
            Connect your Facebook Pages & Instagram in one click
          </p>
        </div>
      </div>

      {/* Primary CTA */}
      {metaConfig?.configured ? (
        <>
          <Card>
            <CardContent className="flex flex-col sm:flex-row items-center justify-between gap-4 py-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <Facebook className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <p className="font-medium text-foreground">Connect with Facebook</p>
                  <p className="text-xs text-muted-foreground">
                    We'll auto-detect your Pages, Instagram accounts, and set up webhooks.
                  </p>
                </div>
              </div>
              <Button
                onClick={startFacebookConnect}
                disabled={!fbReady || fbConnecting || !selectedCompany?.id || !!fbSdkError}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {fbConnecting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Connecting…
                  </>
                ) : !fbReady && !fbSdkError ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading SDK…
                  </>
                ) : (
                  <>
                    <Facebook className="w-4 h-4 mr-2" /> Connect Facebook & Instagram
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {fbSdkError && (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardContent className="py-4 text-sm space-y-2">
                <div className="flex items-start gap-2 text-destructive">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <p className="font-medium">{fbSdkError}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  If the issue persists, the current domain may not be whitelisted in your Meta App.
                  Add the domain shown below under <span className="font-mono">App settings → Basic → App Domains</span>{' '}
                  and <span className="font-mono">Facebook Login → Settings → Allowed Domains for the JavaScript SDK</span>.
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <code className="text-xs bg-background border rounded px-2 py-1 flex-1 truncate">
                    {typeof window !== 'undefined' ? window.location.hostname : ''}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(window.location.hostname);
                      toast.success('Domain copied');
                    }}
                  >
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <Card className="border-dashed border-yellow-500/50 bg-yellow-500/5">
          <CardContent className="py-4 text-sm text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">Meta App not configured</p>
            <p>
              The platform's Meta App ID isn't set yet, so one-click Facebook connect is unavailable.
              Use the manual option below, or ask your administrator to add{' '}
              <span className="font-mono">META_APP_ID</span> and{' '}
              <span className="font-mono">META_CONFIG_ID</span> in backend settings.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Connected pages list */}
      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading credentials…</p>
      ) : credentials?.length ? (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Connected
          </h3>
          {credentials.map((cred) => (
            <Card key={cred.id}>
              <CardContent className="flex items-center justify-between py-4 px-5">
                <div className="flex items-center gap-3 min-w-0">
                  {cred.page_picture_url ? (
                    <img
                      src={cred.page_picture_url}
                      alt={cred.page_name ?? cred.page_id}
                      className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                      <Facebook className="w-5 h-5 text-blue-500" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-foreground text-sm truncate">
                        {cred.page_name ?? `Page ${cred.page_id}`}
                      </span>
                      <Badge variant="secondary" className="text-xs">Facebook</Badge>
                      {cred.ig_user_id && (
                        <Badge className="text-xs bg-gradient-to-r from-purple-500 to-pink-500 text-white border-0">
                          <Instagram className="w-3 h-3 mr-1" /> Instagram
                        </Badge>
                      )}
                      {healthBadge(cred.health_status)}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      ID: {cred.page_id}
                      {cred.connected_via === 'oauth' ? ' • One-click' : ' • Manual token'}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => startEdit(cred)} title="Edit AI instructions">
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteMutation.mutate(cred.id)}
                    className="text-destructive hover:text-destructive"
                    title="Disconnect"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        !showForm && (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-muted-foreground text-sm">
              No pages connected yet. Click "Connect Facebook & Instagram" above to get started.
            </CardContent>
          </Card>
        )
      )}

      {/* WhatsApp section — direct Meta Cloud, parallel to existing Twilio */}
      <div className="space-y-3 pt-2">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          WhatsApp
        </h3>

        {waLoading ? (
          <p className="text-muted-foreground text-sm">Loading WhatsApp settings…</p>
        ) : waCloud ? (
          <Card>
            <CardContent className="flex items-center justify-between py-4 px-5">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0">
                  <MessageCircle className="w-5 h-5 text-green-600" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-foreground text-sm truncate">
                      {waCloud.business_name || waCloud.display_phone_number}
                    </span>
                    <Badge variant="secondary" className="text-xs">Direct WhatsApp</Badge>
                    {healthBadge(waCloud.health_status)}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {waCloud.display_phone_number} • Phone ID {waCloud.phone_number_id}
                  </p>
                </div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <Button variant="ghost" size="icon" onClick={startWaEdit} title="Edit WhatsApp credentials">
                  <Edit2 className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => waDeleteMutation.mutate()}
                  className="text-destructive hover:text-destructive"
                  title="Disconnect and revert to Twilio"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : !waShowForm ? (
          <Card>
            <CardContent className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 py-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0">
                  <MessageCircle className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="font-medium text-foreground">Connect WhatsApp directly via Meta</p>
                  <p className="text-xs text-muted-foreground max-w-md">
                    Existing clients keep using Twilio — nothing changes. New clients can connect their own
                    WhatsApp Business number through Meta for lower per-message cost.
                  </p>
                </div>
              </div>
              <Button variant="outline" onClick={() => setWaShowForm(true)}>
                <Plus className="w-4 h-4 mr-1" /> Add credentials
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {waShowForm && (
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">
                {waCloud ? 'Edit WhatsApp Cloud credentials' : 'Connect WhatsApp Cloud'}
              </CardTitle>
              <CardDescription>
                Find these values in Meta Business Manager → WhatsApp → API Setup. While set, this company
                routes outbound WhatsApp through Meta directly instead of Twilio.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>WhatsApp Business Account ID (WABA)</Label>
                  <Input
                    placeholder="e.g. 102290129340398"
                    value={waForm.waba_id}
                    onChange={(e) => setWaForm({ ...waForm, waba_id: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Phone Number ID</Label>
                  <Input
                    placeholder="e.g. 106540352242922"
                    value={waForm.phone_number_id}
                    onChange={(e) => setWaForm({ ...waForm, phone_number_id: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Display phone number</Label>
                  <Input
                    placeholder="+260 977 123456"
                    value={waForm.display_phone_number}
                    onChange={(e) => setWaForm({ ...waForm, display_phone_number: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>
                    Business name <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input
                    placeholder="Shown in admin only"
                    value={waForm.business_name}
                    onChange={(e) => setWaForm({ ...waForm, business_name: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>System User access token</Label>
                <div className="relative">
                  <Input
                    type={waShowToken ? 'text' : 'password'}
                    placeholder="EAA…"
                    value={waForm.access_token}
                    onChange={(e) => setWaForm({ ...waForm, access_token: e.target.value })}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setWaShowToken(!waShowToken)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {waShowToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Generate a permanent System User token in Meta Business Manager with the{' '}
                  <span className="font-mono">whatsapp_business_messaging</span> and{' '}
                  <span className="font-mono">whatsapp_business_management</span> scopes.
                </p>
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={() => waSaveMutation.mutate()}
                  disabled={
                    !waForm.waba_id ||
                    !waForm.phone_number_id ||
                    !waForm.display_phone_number ||
                    !waForm.access_token ||
                    waSaveMutation.isPending
                  }
                >
                  <Save className="w-4 h-4 mr-1" />
                  {waSaveMutation.isPending ? 'Saving…' : 'Save'}
                </Button>
                <Button variant="outline" onClick={() => { setWaShowForm(false); setWaShowToken(false); }}>
                  <X className="w-4 h-4 mr-1" /> Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Edit form (used by both edit and Advanced manual add) */}
      {showForm && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">
              {editingId ? 'Edit Page' : 'Add Page Manually'}
            </CardTitle>
            <CardDescription>
              {editingId
                ? 'Update credentials or AI instructions for this page.'
                : 'Paste a Page ID and Access Token if you cannot use the one-click connect.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Facebook Page ID</Label>
              <Input
                placeholder="e.g. 123456789012345"
                value={form.page_id}
                onChange={(e) => setForm({ ...form, page_id: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Page Access Token</Label>
              <div className="relative">
                <Input
                  type={showToken ? 'text' : 'password'}
                  placeholder="Paste your page access token"
                  value={form.access_token}
                  onChange={(e) => setForm({ ...form, access_token: e.target.value })}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>
                Instagram Business Account ID{' '}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                placeholder="e.g. 17841400123456789"
                value={form.ig_user_id}
                onChange={(e) => setForm({ ...form, ig_user_id: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>
                Page-specific AI Instructions{' '}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                placeholder="Leave empty to use your company's default AI settings."
                value={form.ai_system_prompt}
                onChange={(e) => setForm({ ...form, ai_system_prompt: e.target.value })}
                rows={3}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={!form.page_id || !form.access_token || saveMutation.isPending}
              >
                <Save className="w-4 h-4 mr-1" />
                {saveMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="outline" onClick={resetForm}>
                <X className="w-4 h-4 mr-1" /> Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Advanced (manual paste) */}
      {!showForm && (
        <Accordion type="single" collapsible>
          <AccordionItem value="advanced" className="border rounded-md px-4">
            <AccordionTrigger className="text-sm text-muted-foreground hover:no-underline">
              Advanced: connect with a Page ID + Token
            </AccordionTrigger>
            <AccordionContent className="pb-4">
              <p className="text-xs text-muted-foreground mb-3">
                For agencies and developers managing pages on behalf of clients. Most users should
                use the one-click button above.
              </p>
              <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
                <Plus className="w-4 h-4 mr-1" /> Add page manually
              </Button>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {/* Page picker dialog */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pick the pages to connect</DialogTitle>
            <DialogDescription>
              We found {discoveredPages.length} Page{discoveredPages.length === 1 ? '' : 's'} you
              manage. Select which ones you want this assistant to handle.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {discoveredPages.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-3 p-3 rounded-md border cursor-pointer hover:bg-muted/40"
              >
                <Checkbox
                  checked={selectedPageIds.includes(p.id)}
                  onCheckedChange={() => togglePage(p.id)}
                />
                {p.picture_url ? (
                  <img src={p.picture_url} alt={p.name} className="w-9 h-9 rounded-full" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center">
                    <Facebook className="w-4 h-4 text-blue-500" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <div className="flex gap-1 mt-0.5">
                    <Badge variant="secondary" className="text-[10px]">FB</Badge>
                    {p.has_instagram && (
                      <Badge className="text-[10px] bg-gradient-to-r from-purple-500 to-pink-500 text-white border-0">
                        IG
                      </Badge>
                    )}
                  </div>
                </div>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerOpen(false)} disabled={confirming}>
              Cancel
            </Button>
            <Button
              onClick={confirmConnect}
              disabled={selectedPageIds.length === 0 || confirming}
            >
              {confirming ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Connecting…
                </>
              ) : (
                `Connect ${selectedPageIds.length} page${selectedPageIds.length === 1 ? '' : 's'}`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
