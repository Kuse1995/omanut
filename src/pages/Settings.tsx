import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

const Settings = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<any>({
    id: null,
    restaurant_name: '',
    restaurant_hours: '',
    menu: '',
    instructions: '',
    currency_prefix: '',
    branches: '',
    seating_areas: ''
  });

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    const { data, error } = await supabase
      .from('agent_config')
      .select('*')
      .single();

    if (error) {
      console.error('Error fetching config:', error);
      return;
    }

    if (data) {
      setConfig(data);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    
    const { error } = await supabase
      .from('agent_config')
      .update({
        restaurant_name: config.restaurant_name,
        restaurant_hours: config.restaurant_hours,
        menu: config.menu,
        instructions: config.instructions,
        currency_prefix: config.currency_prefix,
        branches: config.branches,
        seating_areas: config.seating_areas,
        updated_at: new Date().toISOString()
      })
      .eq('id', config.id);

    setLoading(false);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to save settings",
        variant: "destructive"
      });
      return;
    }

    toast({
      title: "Saved",
      description: "Settings updated successfully"
    });
  };

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">Settings</h1>
        <p className="text-muted-foreground">Configure your AI receptionist</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Agent Configuration</CardTitle>
          <CardDescription>
            Customize how the AI receptionist behaves and responds
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="restaurant_name">Restaurant / Lodge Name</Label>
            <Input
              id="restaurant_name"
              value={config.restaurant_name}
              onChange={(e) => setConfig({ ...config, restaurant_name: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="restaurant_hours">Restaurant Hours</Label>
            <Textarea
              id="restaurant_hours"
              value={config.restaurant_hours}
              onChange={(e) => setConfig({ ...config, restaurant_hours: e.target.value })}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="menu">Menu / Available Items</Label>
            <Textarea
              id="menu"
              value={config.menu}
              onChange={(e) => setConfig({ ...config, menu: e.target.value })}
              rows={4}
              placeholder="Include local foods like fish, braai, nshima, etc."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="instructions">Custom Instructions to AI</Label>
            <Textarea
              id="instructions"
              value={config.instructions}
              onChange={(e) => setConfig({ ...config, instructions: e.target.value })}
              rows={4}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="currency_prefix">Currency Prefix</Label>
              <Input
                id="currency_prefix"
                value={config.currency_prefix}
                onChange={(e) => setConfig({ ...config, currency_prefix: e.target.value })}
                placeholder="K"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="branches">Branches (comma-separated)</Label>
              <Input
                id="branches"
                value={config.branches}
                onChange={(e) => setConfig({ ...config, branches: e.target.value })}
                placeholder="Main, Solwezi"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="seating_areas">Seating Areas (comma-separated)</Label>
              <Input
                id="seating_areas"
                value={config.seating_areas}
                onChange={(e) => setConfig({ ...config, seating_areas: e.target.value })}
                placeholder="poolside,outdoor,inside,VIP"
              />
            </div>
          </div>

          <Button onClick={handleSave} disabled={loading} className="w-full md:w-auto">
            {loading ? 'Saving...' : 'Save Settings'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default Settings;