import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import BackButton from '@/components/BackButton';
import { CompanyDocuments } from '@/components/CompanyDocuments';
import CompanyMedia from '@/components/CompanyMedia';
import { ImageGenerationSettings } from '@/components/ImageGenerationSettings';
import ThemeToggle from '@/components/ThemeToggle';

const Settings = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState({
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
    booking_buffer_minutes: 15
  });

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      // First get the authenticated user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) {
        throw new Error('Not authenticated');
      }

      // Get the user's company_id from the users table
      const { data: userData, error: userDataError } = await supabase
        .from('users')
        .select('company_id')
        .eq('id', user.id)
        .single();

      if (userDataError) throw userDataError;
      if (!userData?.company_id) {
        throw new Error('User has no associated company');
      }

      // Fetch the user's company
      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .eq('id', userData.company_id)
        .single();

      if (error) throw error;

      if (data) {
        setConfig(data);
      }
    } catch (error) {
      console.error('Error fetching config:', error);
      toast({
        title: 'Error',
        description: 'Failed to load settings',
        variant: 'destructive'
      });
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
          booking_buffer_minutes: config.booking_buffer_minutes
        })
        .eq('id', config.id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Company settings saved successfully'
      });
    } catch (error) {
      console.error('Error saving config:', error);
      toast({
        title: 'Error',
        description: 'Failed to save settings',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-app p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <BackButton />
          <ThemeToggle />
        </div>
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gradient mb-2">Company Settings</h1>
          <p className="text-muted-foreground">Configure your AI receptionist's persona and behavior</p>
        </div>

        <Card className="card-glass">
          <CardHeader>
            <CardTitle className="text-foreground">Business Profile</CardTitle>
            <CardDescription>Define your company's identity and AI personality</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="name">Company Name</Label>
              <Input
                id="name"
                value={config.name}
                onChange={(e) => setConfig({ ...config, name: e.target.value })}
                placeholder="e.g., Your Business Name"
                disabled={loading}
              />
            </div>

            <div>
              <Label htmlFor="business_type">Business Type</Label>
              <Input
                id="business_type"
                value={config.business_type}
                onChange={(e) => setConfig({ ...config, business_type: e.target.value })}
                placeholder="e.g., restaurant, hotel, spa"
                disabled={loading}
              />
            </div>

            <div>
              <Label htmlFor="voice_style">Voice Style</Label>
              <Textarea
                id="voice_style"
                value={config.voice_style}
                onChange={(e) => setConfig({ ...config, voice_style: e.target.value })}
                placeholder="Describe how the AI should speak..."
                className="min-h-[80px]"
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground mt-1">
                e.g., "Warm, polite receptionist" or "Professional and concise"
              </p>
            </div>

            <div>
              <Label htmlFor="hours">Hours of Operation</Label>
              <Input
                id="hours"
                value={config.hours}
                onChange={(e) => setConfig({ ...config, hours: e.target.value })}
                placeholder="e.g., Mon-Sun: 10:00 - 23:00"
                disabled={loading}
              />
            </div>

            <div>
              <Label htmlFor="services">Services / Offerings</Label>
              <Textarea
                id="services"
                value={config.services}
                onChange={(e) => setConfig({ ...config, services: e.target.value })}
                placeholder="List your main offerings, services, or menu items..."
                className="min-h-[100px]"
                disabled={loading}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="branches">Branches</Label>
                <Input
                  id="branches"
                  value={config.branches}
                  onChange={(e) => setConfig({ ...config, branches: e.target.value })}
                  placeholder="e.g., Main, Downtown"
                  disabled={loading}
                />
              </div>

              <div>
                <Label htmlFor="currency_prefix">Currency</Label>
                <Input
                  id="currency_prefix"
                  value={config.currency_prefix}
                  onChange={(e) => setConfig({ ...config, currency_prefix: e.target.value })}
                  placeholder="e.g., K, $, €"
                  disabled={loading}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="service_locations">Service Locations / Areas</Label>
              <Input
                id="service_locations"
                value={config.service_locations}
                onChange={(e) => setConfig({ ...config, service_locations: e.target.value })}
                placeholder="e.g., main area,consultation room,studio"
                disabled={loading}
              />
            </div>

            <div>
              <Label htmlFor="twilio_number">Phone Number (PSTN)</Label>
              <Input
                id="twilio_number"
                value={config.twilio_number || ''}
                onChange={(e) => setConfig({ ...config, twilio_number: e.target.value })}
                placeholder="e.g., +1234567890"
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground mt-1">
                For regular phone calls
              </p>
            </div>

            <div>
              <Label htmlFor="whatsapp_number">WhatsApp Number</Label>
              <Input
                id="whatsapp_number"
                value={config.whatsapp_number || ''}
                onChange={(e) => setConfig({ ...config, whatsapp_number: e.target.value })}
                placeholder="whatsapp:+1234567890"
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Your customers can WhatsApp us and our AI will answer automatically
              </p>
            </div>

            <div>
              <Label htmlFor="takeover_number">Takeover Number (WhatsApp)</Label>
              <Input
                id="takeover_number"
                value={config.takeover_number || ''}
                onChange={(e) => setConfig({ ...config, takeover_number: e.target.value })}
                placeholder="+1234567890"
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Boss/Manager WhatsApp number that will receive customer messages during human takeover. Reply from this number to respond to customers directly.
              </p>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="whatsapp_voice_enabled"
                checked={config.whatsapp_voice_enabled || false}
                onChange={(e) => setConfig({ ...config, whatsapp_voice_enabled: e.target.checked })}
                disabled={loading}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="whatsapp_voice_enabled" className="font-normal">
                Enable WhatsApp voice calls
              </Label>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Google Calendar Integration</h3>
              
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="calendar_sync_enabled"
                  checked={config.calendar_sync_enabled || false}
                  onChange={(e) => setConfig({ ...config, calendar_sync_enabled: e.target.checked })}
                  disabled={loading}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <Label htmlFor="calendar_sync_enabled" className="font-normal">
                  Enable calendar sync for reservations
                </Label>
              </div>

              <div>
                <Label htmlFor="google_calendar_id">Google Calendar ID</Label>
                <Input
                  id="google_calendar_id"
                  value={config.google_calendar_id || ''}
                  onChange={(e) => setConfig({ ...config, google_calendar_id: e.target.value })}
                  placeholder="your-calendar@gmail.com"
                  disabled={loading}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Calendar ID from Google Calendar settings (typically your email)
                </p>
              </div>

              <div>
                <Label htmlFor="booking_buffer_minutes">Booking Buffer (minutes)</Label>
                <Input
                  type="number"
                  id="booking_buffer_minutes"
                  value={config.booking_buffer_minutes || 15}
                  onChange={(e) => setConfig({ ...config, booking_buffer_minutes: parseInt(e.target.value) })}
                  disabled={loading}
                  min="0"
                  max="60"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Time buffer before/after reservations to prevent back-to-back bookings
                </p>
              </div>
            </div>

          </CardContent>
        </Card>

        <div className="flex justify-end mt-6">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Settings"}
          </Button>
        </div>

        {config.id && (
          <div className="mt-6 space-y-6">
            <CompanyMedia companyId={config.id} />
            <CompanyDocuments companyId={config.id} />
            <ImageGenerationSettings companyId={config.id} />
          </div>
        )}
      </div>
    </div>
  );
};

export default Settings;