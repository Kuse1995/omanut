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
import { Facebook, Instagram, Plus, Trash2, Edit2, Save, X, Eye, EyeOff, Loader2, CheckCircle2, AlertTriangle, Copy, MessageCircle, RefreshCw } from 'lucide-react';
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

  const [fbConfigError, setFbConfigError] = useState<string | null>(null);
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

  // Load public Meta config (App ID + Login Config ID). The frontend uses
  // these to build the OAuth dialog URL itself — no Facebook JS SDK required
  // (FB.login() is incompatible with Facebook Login for Business because it
  // hardcodes response_type=token).
  const { data: metaConfig } = useQuery({
    queryKey: ['meta-public-config'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('meta-public-config');
      if (error) throw error;
      return data as { app_id: string | null; config_id: string | null; configured: boolean };
    },
  });

  // The redirect URI we register with Meta. Must be added to the Meta App's
  // "Valid OAuth Redirect URIs" list under Facebook Login for Business → Settings.
  const oauthRedirectUri =
    typeof window !== 'undefined' ? `${window.location.origin}/auth/meta/callback` : '';


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
    if (!metaConfig?.app_id) {
      toast.error('Meta App is not configured yet. Add META_APP_ID in backend settings.');
      return;
    }
    if (!selectedCompany?.id) {
      toast.error('Pick a company first.');
      return;
    }

    setFbConnecting(true);
    setFbConfigError(null);

    // Random state nonce for CSRF protection on the OAuth roundtrip.
    const state = crypto.randomUUID();
    sessionStorage.setItem('meta_oauth_state', state);

    // Build Meta's OAuth dialog URL ourselves. Facebook Login for Business
    // ONLY supports response_type=code, and FB.login() (the JS SDK) silently
    // forces response_type=token, so we cannot use the SDK at all.
    const url = new URL('https://www.facebook.com/v19.0/dialog/oauth');
    url.searchParams.set('client_id', metaConfig.app_id);
    if (metaConfig.config_id) url.searchParams.set('config_id', metaConfig.config_id);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', oauthRedirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set(
      'scope',
      'pages_show_list,pages_manage_metadata,pages_read_engagement,pages_messaging,' +
        'pages_manage_posts,instagram_basic,instagram_manage_messages,' +
        'instagram_manage_comments,instagram_content_publish,business_management'
    );

    const popup = window.open(
      url.toString(),
      'meta-oauth',
      'width=600,height=720,menubar=no,toolbar=no,location=no'
    );

    if (!popup) {
      setFbConnecting(false);
      toast.error(
        'Could not open the Facebook login window. Allow popups for this site and try again.',
        { duration: 8000 }
      );
      return;
    }

    let settled = false;
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(closedPoll);
      window.clearTimeout(timeoutId);
    };

    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      if (!ev.data || ev.data.source !== 'meta-oauth') return;
      if (settled) return;
      settled = true;
      cleanup();

      const expected = sessionStorage.getItem('meta_oauth_state');
      sessionStorage.removeItem('meta_oauth_state');

      if (ev.data.error) {
        setFbConnecting(false);
        toast.error(`Facebook login failed: ${ev.data.error}`, { duration: 8000 });
        return;
      }
      if (!ev.data.code) {
        setFbConnecting(false);
        toast.error('Facebook login was cancelled.');
        return;
      }
      if (ev.data.state !== expected) {
        setFbConnecting(false);
        toast.error('Security check failed (state mismatch). Please try again.');
        return;
      }

      // Exchange the code on the backend.
      (async () => {
        try {
          const { data, error } = await supabase.functions.invoke('meta-oauth-exchange', {
            body: {
              code: ev.data.code,
              redirect_uri: oauthRedirectUri,
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

    // If the user closes the popup without completing, free the UI.
    const closedPoll = window.setInterval(() => {
      if (popup.closed && !settled) {
        settled = true;
        cleanup();
        setFbConnecting(false);
      }
    }, 700);

    // Hard 5-minute safety net.
    const timeoutId = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        setFbConnecting(false);
        try { popup.close(); } catch { /* ignore */ }
        toast.error('Facebook login timed out. Please try again.');
      }
    }, 5 * 60 * 1000);

    window.addEventListener('message', onMessage);
  }, [metaConfig?.app_id, metaConfig?.config_id, oauthRedirectUri, selectedCompany?.id]);


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

  const resubscribeMutation = useMutation({
    mutationFn: async (credentialId: string) => {
      const { data, error } = await supabase.functions.invoke('subscribe-meta-page', {
        body: { credential_id: credentialId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Re-subscribe failed');
      return data;
    },
    onSuccess: (data) => {
      const fields = (data?.subscribed_fields || []).join(', ');
      toast.success(`Re-subscribed to ${fields || 'webhook events'}. Comments should flow within ~1 min.`);
      queryClient.invalidateQueries({ queryKey: ['meta-credentials'] });
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
                disabled={fbConnecting || !selectedCompany?.id || !metaConfig?.app_id}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {fbConnecting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Connecting…
                  </>
                ) : (
                  <>
                    <Facebook className="w-4 h-4 mr-2" /> Connect Facebook & Instagram
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Show the redirect URI the admin needs to whitelist in Meta */}
          <Card className="border-dashed">
            <CardContent className="py-4 text-xs text-muted-foreground space-y-2">
              <p className="font-medium text-foreground">
                One-time setup in Meta App Dashboard
              </p>
              <p>
                Add this exact URL under{' '}
                <span className="font-mono">Facebook Login for Business → Settings → Valid OAuth Redirect URIs</span>:
              </p>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-background border rounded px-2 py-1 flex-1 truncate">
                  {oauthRedirectUri}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(oauthRedirectUri);
                    toast.success('Redirect URI copied');
                  }}
                >
                  <Copy className="w-3 h-3" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {fbConfigError && (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardContent className="py-4 text-sm">
                <div className="flex items-start gap-2 text-destructive">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <p className="font-medium">{fbConfigError}</p>
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
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => resubscribeMutation.mutate(cred.id)}
                    disabled={resubscribeMutation.isPending && resubscribeMutation.variables === cred.id}
                    title="Re-subscribe to comment & message webhooks (use if AI stopped replying to FB comments)"
                  >
                    {resubscribeMutation.isPending && resubscribeMutation.variables === cred.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                  </Button>
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
