import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { CompanyDocuments } from '@/components/CompanyDocuments';
import CompanyMedia from '@/components/CompanyMedia';
import { ImageGenerationSettings } from '@/components/ImageGenerationSettings';
import ThemeToggle from '@/components/ThemeToggle';
import ClientLayout from '@/components/dashboard/ClientLayout';
import PhoneInput from '@/components/setup/PhoneInput';
import { Building2, Phone, Calendar as CalendarIcon, Image as ImageIcon, FileText, Save, Lock, Copy, Check } from 'lucide-react';
import { useIsPlatformAdmin } from '@/hooks/useIsPlatformAdmin';
import { formatPhone } from '@/lib/format';

const Settings = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: isAdmin } = useIsPlatformAdmin();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [config, setConfig] = useState<any>({
    id: '',
    name: '',
    business_type: '',
    voice_style: 'Warm, polite receptionist.',
    hours: '',
    services: '',
    branches: '',
    service_locations: '',
    currency_prefix: 'K',
    twilio_number: '',
    whatsapp_number: '',
    whatsapp_voice_enabled: false,
    takeover_number: '',
    google_calendar_id: '',
    calendar_sync_enabled: false,
    booking_buffer_minutes: 15,
  });

  useEffect(() => { fetchConfig(); }, []);

  const fetchConfig = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: userData } = await supabase
        .from('users')
        .select('company_id')
        .eq('id', user.id)
        .single();

      if (!userData?.company_id) throw new Error('User has no associated company');

      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .eq('id', userData.company_id)
        .single();

      if (error) throw error;
      if (data) setConfig(data);
    } catch (error) {
      console.error('Error fetching config:', error);
      toast({ title: 'Error', description: 'Failed to load settings', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('companies')
        .update({
          name: config.name,
          business_type: config.business_type,
          voice_style: config.voice_style,
          hours: config.hours,
          services: config.services,
          branches: config.branches,
          service_locations: config.service_locations,
          currency_prefix: config.currency_prefix,
          twilio_number: config.twilio_number,
          whatsapp_number: config.whatsapp_number,
          whatsapp_voice_enabled: config.whatsapp_voice_enabled,
          takeover_number: config.takeover_number,
          google_calendar_id: config.google_calendar_id,
          calendar_sync_enabled: config.calendar_sync_enabled,
          booking_buffer_minutes: config.booking_buffer_minutes,
        })
        .eq('id', config.id);

      if (error) throw error;
      toast({ title: 'Saved', description: 'Your settings have been updated' });
    } catch (error) {
      console.error('Error saving config:', error);
      toast({ title: 'Error', description: 'Failed to save settings', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const update = (patch: Partial<typeof config>) => setConfig({ ...config, ...patch });

  return (
    <ClientLayout>
      <div className="p-4 sm:p-6 lg:p-8 pb-24 md:pb-8">
        <header className="flex items-start sm:items-center justify-between mb-6 gap-4 flex-col sm:flex-row">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
            <p className="text-muted-foreground mt-1">
              Manage your business profile, AI personality, and channels.
            </p>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <ThemeToggle />
            <Button onClick={handleSave} disabled={saving || loading} className="gap-2">
              <Save className="w-4 h-4" />
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </header>

        <Tabs defaultValue="business" className="w-full">
          <TabsList className="grid grid-cols-2 sm:grid-cols-5 w-full sm:w-auto h-auto sm:h-10 mb-6">
            <TabsTrigger value="business" className="gap-1.5"><Building2 className="w-4 h-4" />Business</TabsTrigger>
            <TabsTrigger value="numbers" className="gap-1.5"><Phone className="w-4 h-4" />Numbers</TabsTrigger>
            <TabsTrigger value="calendar" className="gap-1.5"><CalendarIcon className="w-4 h-4" />Calendar</TabsTrigger>
            <TabsTrigger value="media" className="gap-1.5"><ImageIcon className="w-4 h-4" />Media</TabsTrigger>
            <TabsTrigger value="documents" className="gap-1.5"><FileText className="w-4 h-4" />Knowledge</TabsTrigger>
          </TabsList>

          {/* Business */}
          <TabsContent value="business" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Business profile</CardTitle>
                <CardDescription>How your AI introduces itself and what it knows about your business.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="name">Company name</Label>
                  <Input id="name" value={config.name || ''} onChange={(e) => update({ name: e.target.value })} disabled={loading} />
                </div>
                <div>
                  <Label htmlFor="business_type">Business type</Label>
                  <Input id="business_type" value={config.business_type || ''} onChange={(e) => update({ business_type: e.target.value })} placeholder="e.g. restaurant, hotel, retail" disabled={loading} />
                </div>
                <div>
                  <Label htmlFor="voice_style">AI voice & tone</Label>
                  <Textarea id="voice_style" value={config.voice_style || ''} onChange={(e) => update({ voice_style: e.target.value })} className="min-h-[80px]" disabled={loading} />
                  <p className="text-xs text-muted-foreground mt-1">e.g. "Warm, polite receptionist" or "Direct and professional".</p>
                </div>
                <div>
                  <Label htmlFor="hours">Hours of operation</Label>
                  <Input id="hours" value={config.hours || ''} onChange={(e) => update({ hours: e.target.value })} placeholder="Mon–Sat: 08:00 – 18:00" disabled={loading} />
                </div>
                <div>
                  <Label htmlFor="services">Services / offerings</Label>
                  <Textarea id="services" value={config.services || ''} onChange={(e) => update({ services: e.target.value })} className="min-h-[100px]" disabled={loading} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="branches">Branches</Label>
                    <Input id="branches" value={config.branches || ''} onChange={(e) => update({ branches: e.target.value })} placeholder="Main, Cairo Road" disabled={loading} />
                  </div>
                  <div>
                    <Label htmlFor="currency_prefix">Currency symbol</Label>
                    <Input id="currency_prefix" value={config.currency_prefix || 'K'} onChange={(e) => update({ currency_prefix: e.target.value })} placeholder="K, $, €" disabled={loading} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="service_locations">Service locations / areas</Label>
                  <Input id="service_locations" value={config.service_locations || ''} onChange={(e) => update({ service_locations: e.target.value })} placeholder="main hall, consultation room" disabled={loading} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Numbers */}
          <TabsContent value="numbers" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Phone & WhatsApp</CardTitle>
                <CardDescription>
                  Your assigned WhatsApp number. Provisioning and routing are managed by the Omanut team.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Read-only WhatsApp number for everyone */}
                <div className="rounded-lg border border-border bg-card/40 p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                      Your WhatsApp number
                    </p>
                    <p className="text-base font-mono font-semibold mt-0.5 truncate">
                      {config.whatsapp_number
                        ? formatPhone(config.whatsapp_number.replace('whatsapp:', '')) ||
                          config.whatsapp_number.replace('whatsapp:', '')
                        : 'Pending — being provisioned by Omanut'}
                    </p>
                  </div>
                  {config.whatsapp_number && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        const v = config.whatsapp_number.replace('whatsapp:', '');
                        try {
                          await navigator.clipboard.writeText(v);
                          setCopied(true);
                          toast({ title: 'Copied' });
                          setTimeout(() => setCopied(false), 2000);
                        } catch {
                          toast({ title: 'Copy failed', variant: 'destructive' });
                        }
                      }}
                      className="gap-1.5"
                    >
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                  )}
                </div>

                {/* Boss takeover — clients control this */}
                <PhoneInput
                  id="takeover_number"
                  label="Your WhatsApp (for AI alerts)"
                  value={config.takeover_number || ''}
                  onChange={(v) => update({ takeover_number: v })}
                  helper="Where the AI escalates urgent customer messages. You can reply directly from this number."
                />

                {/* Admin-only: raw infrastructure controls */}
                {isAdmin ? (
                  <div className="border-t border-border pt-4 mt-4 space-y-4">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Lock className="w-3.5 h-3.5" /> Admin-only infrastructure
                    </div>
                    <PhoneInput
                      id="twilio_number"
                      label="Twilio phone number (calls)"
                      value={config.twilio_number || ''}
                      onChange={(v) => update({ twilio_number: v })}
                      helper="The Twilio number customers call. Leave empty if WhatsApp-only."
                    />
                    <div>
                      <Label htmlFor="whatsapp_number">WhatsApp number (Twilio format)</Label>
                      <Input
                        id="whatsapp_number"
                        value={config.whatsapp_number || ''}
                        onChange={(e) => update({ whatsapp_number: e.target.value })}
                        placeholder="whatsapp:+260971234567"
                        disabled={loading}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Format: <code>whatsapp:+260…</code>
                      </p>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border p-3">
                      <div>
                        <p className="text-sm font-medium">Enable WhatsApp voice calls</p>
                        <p className="text-xs text-muted-foreground">Let customers call your AI through WhatsApp.</p>
                      </div>
                      <Switch
                        checked={!!config.whatsapp_voice_enabled}
                        onCheckedChange={(v) => update({ whatsapp_voice_enabled: v })}
                        disabled={loading}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground border-t border-border pt-3">
                    Need a different number or call routing?{' '}
                    <a
                      href="https://wa.me/260977000000"
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline"
                    >
                      Chat with Omanut support
                    </a>
                    .
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Calendar */}
          <TabsContent value="calendar" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Google Calendar</CardTitle>
                <CardDescription>Optional — sync confirmed reservations into a Google Calendar.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <p className="text-sm font-medium">Calendar sync</p>
                    <p className="text-xs text-muted-foreground">Push approved reservations to Google Calendar.</p>
                  </div>
                  <Switch
                    checked={!!config.calendar_sync_enabled}
                    onCheckedChange={(v) => update({ calendar_sync_enabled: v })}
                    disabled={loading}
                  />
                </div>
                <div>
                  <Label htmlFor="google_calendar_id">Google Calendar ID</Label>
                  <Input
                    id="google_calendar_id"
                    value={config.google_calendar_id || ''}
                    onChange={(e) => update({ google_calendar_id: e.target.value })}
                    placeholder="your-calendar@gmail.com"
                    disabled={loading}
                  />
                </div>
                <div>
                  <Label htmlFor="booking_buffer_minutes">Booking buffer (minutes)</Label>
                  <Input
                    id="booking_buffer_minutes"
                    type="number"
                    min={0}
                    max={120}
                    value={config.booking_buffer_minutes ?? 15}
                    onChange={(e) => update({ booking_buffer_minutes: parseInt(e.target.value || '0', 10) })}
                    disabled={loading}
                  />
                  <p className="text-xs text-muted-foreground mt-1">Time blocked before/after each booking.</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Media */}
          <TabsContent value="media" className="space-y-6">
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="flex items-center justify-between p-4">
                <p className="text-sm">
                  Media & AI image generation now have a dedicated page.
                </p>
                <Button size="sm" onClick={() => navigate('/media')}>
                  Open Media Studio
                </Button>
              </CardContent>
            </Card>
            {config.id && <CompanyMedia companyId={config.id} />}
            {config.id && <ImageGenerationSettings companyId={config.id} />}
          </TabsContent>

          {/* Documents / KB */}
          <TabsContent value="documents" className="space-y-6">
            {config.id && <CompanyDocuments companyId={config.id} />}
          </TabsContent>
        </Tabs>
      </div>
    </ClientLayout>
  );
};

export default Settings;
