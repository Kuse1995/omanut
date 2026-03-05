import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Facebook, Instagram, Plus, Trash2, Edit2, Save, X, Eye, EyeOff } from 'lucide-react';
import { useCompany } from '@/context/CompanyContext';

interface MetaCredential {
  id: string;
  page_id: string;
  access_token: string;
  platform: string;
  ai_system_prompt: string;
  ig_user_id: string | null;
  company_id: string;
  created_at: string;
}

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

  const maskToken = (token: string) =>
    token.length > 8 ? `${token.slice(0, 4)}${'•'.repeat(16)}${token.slice(-4)}` : '••••••••';

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Meta Integrations</h2>
          <p className="text-muted-foreground text-sm">
            Connect your Facebook Pages & Instagram for AI-powered replies
          </p>
        </div>
        {!showForm && (
          <Button onClick={() => setShowForm(true)} size="sm">
            <Plus className="w-4 h-4 mr-1" /> Add Page
          </Button>
        )}
      </div>

      {showForm && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">
              {editingId ? 'Edit Page Credential' : 'New Page Credential'}
            </CardTitle>
            <CardDescription>
              Enter your Facebook Page credentials. If Instagram is linked, add the IG Business ID too.
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
              <Label>Instagram Business Account ID <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                placeholder="e.g. 17841400123456789"
                value={form.ig_user_id}
                onChange={(e) => setForm({ ...form, ig_user_id: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                If your Instagram Professional account is linked to this Facebook Page, paste the IG Business Account ID here to enable Instagram publishing with the same token.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Additional Instructions <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea
                placeholder="Leave empty to use your company's AI settings and knowledge base automatically. Add text here only for page-specific overrides..."
                value={form.ai_system_prompt}
                onChange={(e) => setForm({ ...form, ai_system_prompt: e.target.value })}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                Your company's system instructions, QA style, banned topics, and knowledge base are loaded automatically. Use this field only for page-specific additions.
              </p>
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
              No Meta credentials saved yet. Click "Add Page" to get started.
            </CardContent>
          </Card>
        )
      ) : (
        <div className="space-y-3">
          {credentials.map((cred) => (
            <Card key={cred.id}>
              <CardContent className="flex items-center justify-between py-4 px-5">
                <div className="flex items-center gap-3 min-w-0">
                  <Facebook className="w-5 h-5 text-blue-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground text-sm">
                        Page: {cred.page_id}
                      </span>
                      <Badge variant="secondary" className="text-xs">Facebook</Badge>
                      {cred.ig_user_id && (
                        <Badge className="text-xs bg-gradient-to-r from-purple-500 to-pink-500 text-white border-0">
                          <Instagram className="w-3 h-3 mr-1" /> Instagram
                        </Badge>
                      )}
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
