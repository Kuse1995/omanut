import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Facebook, Instagram, Plus, Trash2, Edit2, Save, X, Eye, EyeOff } from 'lucide-react';

interface MetaCredential {
  id: string;
  page_id: string;
  access_token: string;
  platform: 'facebook' | 'instagram';
  ai_system_prompt: string;
  created_at: string;
}

export const MetaIntegrationsPanel = () => {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [form, setForm] = useState({
    page_id: '',
    access_token: '',
    platform: 'facebook' as 'facebook' | 'instagram',
    ai_system_prompt: '',
  });

  const { data: credentials, isLoading } = useQuery({
    queryKey: ['meta-credentials'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meta_credentials')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as MetaCredential[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      if (editingId) {
        const { error } = await supabase
          .from('meta_credentials')
          .update({ ...form, updated_at: new Date().toISOString() })
          .eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('meta_credentials')
          .insert({ ...form, user_id: user.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meta-credentials'] });
      toast.success(editingId ? 'Credential updated' : 'Credential saved');
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
    setForm({ page_id: '', access_token: '', platform: 'facebook', ai_system_prompt: '' });
    setEditingId(null);
    setShowForm(false);
    setShowToken(false);
  };

  const startEdit = (cred: MetaCredential) => {
    setForm({
      page_id: cred.page_id,
      access_token: cred.access_token,
      platform: cred.platform,
      ai_system_prompt: cred.ai_system_prompt || '',
    });
    setEditingId(cred.id);
    setShowForm(true);
  };

  const maskToken = (token: string) =>
    token.length > 8 ? `${token.slice(0, 4)}${'•'.repeat(16)}${token.slice(-4)}` : '••••••••';

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Meta Integrations</h2>
          <p className="text-muted-foreground text-sm">
            Connect your Facebook & Instagram pages for AI-powered replies
          </p>
        </div>
        {!showForm && (
          <Button onClick={() => setShowForm(true)} size="sm">
            <Plus className="w-4 h-4 mr-1" /> Add Credential
          </Button>
        )}
      </div>

      {showForm && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">
              {editingId ? 'Edit Credential' : 'New Credential'}
            </CardTitle>
            <CardDescription>
              Enter your Meta page credentials and AI prompt
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Platform</Label>
              <Select
                value={form.platform}
                onValueChange={(v) => setForm({ ...form, platform: v as 'facebook' | 'instagram' })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="facebook">
                    <span className="flex items-center gap-2"><Facebook className="w-4 h-4" /> Facebook</span>
                  </SelectItem>
                  <SelectItem value="instagram">
                    <span className="flex items-center gap-2"><Instagram className="w-4 h-4" /> Instagram</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Page ID</Label>
              <Input
                placeholder="e.g. 123456789012345"
                value={form.page_id}
                onChange={(e) => setForm({ ...form, page_id: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Access Token</Label>
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
              <Label>AI System Prompt</Label>
              <Textarea
                placeholder="Enter the system prompt the AI should use when replying on this page..."
                value={form.ai_system_prompt}
                onChange={(e) => setForm({ ...form, ai_system_prompt: e.target.value })}
                rows={4}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={!form.page_id || !form.access_token || saveMutation.isPending}
              >
                <Save className="w-4 h-4 mr-1" />
                {saveMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
              <Button variant="outline" onClick={resetForm}>
                <X className="w-4 h-4 mr-1" /> Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading credentials...</p>
      ) : !credentials?.length ? (
        !showForm && (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center text-muted-foreground">
              No Meta credentials saved yet. Click "Add Credential" to get started.
            </CardContent>
          </Card>
        )
      ) : (
        <div className="space-y-3">
          {credentials.map((cred) => (
            <Card key={cred.id}>
              <CardContent className="flex items-center justify-between py-4 px-5">
                <div className="flex items-center gap-3 min-w-0">
                  {cred.platform === 'facebook' ? (
                    <Facebook className="w-5 h-5 text-blue-500 flex-shrink-0" />
                  ) : (
                    <Instagram className="w-5 h-5 text-pink-500 flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground text-sm">
                        Page: {cred.page_id}
                      </span>
                      <Badge variant="secondary" className="text-xs capitalize">
                        {cred.platform}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      Token: {maskToken(cred.access_token)}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => startEdit(cred)}>
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteMutation.mutate(cred.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
