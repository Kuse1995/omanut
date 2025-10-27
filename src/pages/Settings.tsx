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
import ThemeToggle from '@/components/ThemeToggle';

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
    twilio_number: '',
    whatsapp_number: '',
    whatsapp_voice_enabled: false
  });

  const [aiInstructions, setAiInstructions] = useState({
    system_instructions: '',
    qa_style: '',
    banned_topics: ''
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
        
        // Fetch AI overrides
        const { data: aiData } = await supabase
          .from('company_ai_overrides')
          .select('*')
          .eq('company_id', data.id)
          .single();
        
        if (aiData) {
          setAiInstructions({
            system_instructions: aiData.system_instructions || '',
            qa_style: aiData.qa_style || '',
            banned_topics: aiData.banned_topics || ''
          });
        }
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
          twilio_number: config.twilio_number,
          whatsapp_number: config.whatsapp_number,
          whatsapp_voice_enabled: config.whatsapp_voice_enabled
        })
        .eq('id', config.id);

      if (error) throw error;

      // Upsert AI instructions
      const { error: aiError } = await supabase
        .from('company_ai_overrides')
        .upsert({
          company_id: config.id,
          system_instructions: aiInstructions.system_instructions,
          qa_style: aiInstructions.qa_style,
          banned_topics: aiInstructions.banned_topics
        });

      if (aiError) throw aiError;

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

          </CardContent>
        </Card>

        <Card className="card-glass mt-6">
          <CardHeader>
            <CardTitle className="text-foreground">AI Instructions & Behavior</CardTitle>
            <CardDescription>Customize how your AI assistant responds and behaves</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="system_instructions">Custom System Instructions</Label>
              <Textarea
                id="system_instructions"
                value={aiInstructions.system_instructions}
                onChange={(e) => setAiInstructions({ ...aiInstructions, system_instructions: e.target.value })}
                placeholder="Add specific instructions for the AI (e.g., 'Always mention our special promotions', 'Use friendly, casual language', etc.)"
                className="min-h-[120px]"
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground mt-1">
                These instructions will guide how the AI responds. Be specific about tone, topics to emphasize, and how to handle common questions.
              </p>
            </div>

            <div>
              <Label htmlFor="qa_style">Question & Answer Style</Label>
              <Textarea
                id="qa_style"
                value={aiInstructions.qa_style}
                onChange={(e) => setAiInstructions({ ...aiInstructions, qa_style: e.target.value })}
                placeholder="Define how the AI should answer questions (e.g., 'Keep answers under 2 sentences', 'Always ask clarifying questions', 'Provide detailed explanations')"
                className="min-h-[100px]"
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground mt-1">
                This helps the AI understand synonyms and variations. Example: "Tuition, fees, cost, price all mean the same thing - answer with our pricing information"
              </p>
            </div>

            <div>
              <Label htmlFor="banned_topics">Topics to Avoid</Label>
              <Textarea
                id="banned_topics"
                value={aiInstructions.banned_topics}
                onChange={(e) => setAiInstructions({ ...aiInstructions, banned_topics: e.target.value })}
                placeholder="List topics the AI should not discuss (e.g., 'Do not discuss competitor pricing', 'Avoid political topics', etc.)"
                className="min-h-[80px]"
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Specify what topics the AI should politely decline to answer or redirect.
              </p>
            </div>

            <Button
              onClick={handleSave} 
              disabled={saving || loading} 
              className="w-full bg-primary hover:bg-primary/90"
            >
              {saving ? 'Saving...' : 'Save All Settings'}
            </Button>
          </CardContent>
        </Card>

        {config.id && (
          <div className="mt-6">
            <CompanyDocuments companyId={config.id} />
          </div>
        )}
      </div>
    </div>
  );
};

export default Settings;