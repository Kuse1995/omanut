import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import BackButton from '@/components/BackButton';

const Settings = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState({
    id: '',
    name: '',
    business_type: 'restaurant',
    voice_style: 'Warm, polite receptionist.',
    hours: '',
    menu_or_offerings: '',
    branches: '',
    seating_areas: '',
    currency_prefix: 'K',
    twilio_number: ''
  });

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .limit(1)
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
          menu_or_offerings: config.menu_or_offerings,
          branches: config.branches,
          seating_areas: config.seating_areas,
          currency_prefix: config.currency_prefix,
          twilio_number: config.twilio_number
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
        <BackButton />
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
                placeholder="e.g., Streamside Lodge"
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
              <Label htmlFor="menu_or_offerings">Menu / Services</Label>
              <Textarea
                id="menu_or_offerings"
                value={config.menu_or_offerings}
                onChange={(e) => setConfig({ ...config, menu_or_offerings: e.target.value })}
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
              <Label htmlFor="seating_areas">Seating/Service Areas</Label>
              <Input
                id="seating_areas"
                value={config.seating_areas}
                onChange={(e) => setConfig({ ...config, seating_areas: e.target.value })}
                placeholder="e.g., poolside,outdoor,inside,VIP"
                disabled={loading}
              />
            </div>

            <div>
              <Label htmlFor="twilio_number">Twilio Phone Number</Label>
              <Input
                id="twilio_number"
                value={config.twilio_number || ''}
                onChange={(e) => setConfig({ ...config, twilio_number: e.target.value })}
                placeholder="e.g., +1234567890"
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Forward your local number to this Twilio number
              </p>
            </div>

            <Button 
              onClick={handleSave} 
              disabled={saving || loading} 
              className="w-full bg-primary hover:bg-primary/90"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Settings;