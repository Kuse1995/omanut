import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCompany } from '@/context/CompanyContext';
import { useCompanyRole } from '@/hooks/useCompanyRole';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Megaphone, CheckCircle2, AlertTriangle, Plus, Pause, Play, X, Trash2, RefreshCw, Loader2, Lock } from 'lucide-react';

type Credential = { id: string; page_id: string; ad_account_id: string | null; access_token: string };

type Campaign = {
  id: string;
  name: string;
  objective: string;
  status: string;
  daily_budget_cents: number | null;
  lifetime_budget_cents: number | null;
  currency: string;
  start_at: string | null;
  end_at: string | null;
  meta_campaign_id: string | null;
  last_error: string | null;
  created_at: string;
};

type Insight = {
  campaign_id: string;
  spend_cents: number;
  impressions: number;
  clicks: number;
  results: number;
};

const OBJECTIVES = [
  { value: 'OUTCOME_TRAFFIC', label: 'Traffic (clicks to website)' },
  { value: 'OUTCOME_ENGAGEMENT', label: 'Engagement (likes, comments, shares)' },
  { value: 'OUTCOME_LEADS', label: 'Leads (form fills)' },
  { value: 'OUTCOME_SALES', label: 'Sales (conversions)' },
  { value: 'OUTCOME_AWARENESS', label: 'Awareness (reach)' },
];

const CTA_OPTIONS = ['SHOP_NOW','LEARN_MORE','SIGN_UP','BOOK_TRAVEL','CONTACT_US','GET_QUOTE','ORDER_NOW','MESSAGE_PAGE','WHATSAPP_MESSAGE'];

export const AdsPanel = () => {
  const { selectedCompany } = useCompany();
  const { isOwner } = useCompanyRole();
  const qc = useQueryClient();
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [adAccountInput, setAdAccountInput] = useState('');
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [verifying, setVerifying] = useState(false);

  // Owner gate
  if (!isOwner) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <Lock className="w-10 h-10 mx-auto text-muted-foreground" />
            <h3 className="text-lg font-semibold">Owner-only</h3>
            <p className="text-sm text-muted-foreground">
              Only company owners can launch and manage Facebook ads. Ask the owner to grant access or run the campaigns themselves.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { data: credentials } = useQuery({
    queryKey: ['meta-credentials', selectedCompany?.id],
    queryFn: async () => {
      if (!selectedCompany?.id) return [] as Credential[];
      const { data, error } = await supabase
        .from('meta_credentials')
        .select('id, page_id, ad_account_id, access_token')
        .eq('company_id', selectedCompany.id);
      if (error) throw error;
      return (data || []) as Credential[];
    },
    enabled: !!selectedCompany?.id,
  });

  const credential = credentials?.[0];

  const { data: campaigns, isLoading: loadingCampaigns } = useQuery({
    queryKey: ['ad-campaigns', selectedCompany?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meta_ad_campaigns')
        .select('*')
        .eq('company_id', selectedCompany!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as Campaign[];
    },
    enabled: !!selectedCompany?.id,
  });

  const { data: insights } = useQuery({
    queryKey: ['ad-insights', selectedCompany?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meta_ad_insights_daily')
        .select('campaign_id, spend_cents, impressions, clicks, results')
        .eq('company_id', selectedCompany!.id);
      if (error) throw error;
      // Aggregate per campaign
      const map = new Map<string, Insight>();
      for (const row of data || []) {
        const cur = map.get(row.campaign_id) || { campaign_id: row.campaign_id, spend_cents: 0, impressions: 0, clicks: 0, results: 0 };
        cur.spend_cents += row.spend_cents || 0;
        cur.impressions += row.impressions || 0;
        cur.clicks += row.clicks || 0;
        cur.results += row.results || 0;
        map.set(row.campaign_id, cur);
      }
      return map;
    },
    enabled: !!selectedCompany?.id,
  });

  const saveAdAccount = useMutation({
    mutationFn: async (id: string) => {
      const cleaned = id.trim().replace(/^act_/, '');
      const { error } = await supabase
        .from('meta_credentials')
        .update({ ad_account_id: `act_${cleaned}` })
        .eq('id', credential!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meta-credentials'] });
      toast.success('Ad account saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runVerify = async (idOverride?: string) => {
    if (!credential) return;
    setVerifying(true);
    setVerifyResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('meta-ads-verify', {
        body: {
          credential_id: credential.id,
          company_id: selectedCompany!.id,
          ad_account_id: idOverride || credential.ad_account_id || adAccountInput || undefined,
        },
      });
      if (error) throw error;
      setVerifyResult(data);
    } catch (e: any) {
      toast.error(e.message || 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const controlMutation = useMutation({
    mutationFn: async (vars: { campaign_id: string; action: 'pause'|'resume'|'end'|'delete' }) => {
      const { data, error } = await supabase.functions.invoke('meta-ads-control', { body: vars });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_d, v) => {
      toast.success(`Campaign ${v.action}d`);
      qc.invalidateQueries({ queryKey: ['ad-campaigns'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!selectedCompany) {
    return <div className="text-center text-muted-foreground py-12">Select a company first.</div>;
  }

  const ready = credential?.ad_account_id && credentials && credentials.length > 0;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Megaphone className="w-6 h-6 text-primary" /> Facebook & Instagram Ads
          </h2>
          <p className="text-sm text-muted-foreground">Launch and manage paid campaigns straight from this dashboard.</p>
        </div>
        {ready && (
          <Button onClick={() => setWizardOpen(true)}>
            <Plus className="w-4 h-4 mr-1" /> New Campaign
          </Button>
        )}
      </div>

      {!credential ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center space-y-2">
            <AlertTriangle className="w-8 h-8 mx-auto text-yellow-500" />
            <p className="font-medium">No Facebook page connected</p>
            <p className="text-sm text-muted-foreground">Add a page in Meta Integrations first, then come back here.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ad account</CardTitle>
            <CardDescription>
              Paste your Meta Ad Account ID (looks like <code>act_1234567890</code>) and verify access.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              <Input
                placeholder="act_1234567890"
                value={adAccountInput || credential.ad_account_id || ''}
                onChange={(e) => setAdAccountInput(e.target.value)}
                className="max-w-xs"
              />
              <Button
                variant="secondary"
                onClick={async () => {
                  if (!adAccountInput) return toast.error('Enter an Ad Account ID');
                  await saveAdAccount.mutateAsync(adAccountInput);
                  setAdAccountInput('');
                }}
                disabled={saveAdAccount.isPending || !adAccountInput}
              >
                Save
              </Button>
              <Button onClick={() => { setVerifyOpen(true); runVerify(); }} disabled={verifying}>
                {verifying ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
                Verify access
              </Button>
            </div>
            {credential.ad_account_id && (
              <p className="text-xs text-muted-foreground">Current: <code>{credential.ad_account_id}</code></p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Campaigns list */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold">Campaigns</h3>
        {loadingCampaigns ? (
          <Skeleton className="h-32" />
        ) : !campaigns?.length ? (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No campaigns yet. {ready ? 'Click "New Campaign" to launch your first one.' : 'Set up your ad account first.'}
            </CardContent>
          </Card>
        ) : (
          campaigns.map((c) => {
            const ins = insights?.get(c.id);
            const budget = c.daily_budget_cents
              ? `${(c.daily_budget_cents/100).toFixed(2)} ${c.currency}/day`
              : c.lifetime_budget_cents
              ? `${(c.lifetime_budget_cents/100).toFixed(2)} ${c.currency} total`
              : '—';
            return (
              <Card key={c.id}>
                <CardContent className="py-4 px-5 flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold truncate">{c.name}</span>
                      <StatusBadge status={c.status} />
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {OBJECTIVES.find(o => o.value === c.objective)?.label || c.objective} · {budget}
                    </div>
                    {c.last_error && (
                      <div className="text-xs text-destructive mt-1 break-words">⚠ {c.last_error}</div>
                    )}
                    {ins && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-xs">
                        <Stat label="Spend" value={`${(ins.spend_cents/100).toFixed(2)} ${c.currency}`} />
                        <Stat label="Impressions" value={ins.impressions.toLocaleString()} />
                        <Stat label="Clicks" value={ins.clicks.toLocaleString()} />
                        <Stat label="Results" value={ins.results.toLocaleString()} />
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    {c.status === 'ACTIVE' && (
                      <Button size="sm" variant="ghost" onClick={() => controlMutation.mutate({ campaign_id: c.id, action: 'pause' })}>
                        <Pause className="w-4 h-4" />
                      </Button>
                    )}
                    {c.status === 'PAUSED' && c.meta_campaign_id && (
                      <Button size="sm" variant="ghost" onClick={() => controlMutation.mutate({ campaign_id: c.id, action: 'resume' })}>
                        <Play className="w-4 h-4" />
                      </Button>
                    )}
                    {c.status !== 'ARCHIVED' && c.meta_campaign_id && (
                      <Button size="sm" variant="ghost" onClick={() => controlMutation.mutate({ campaign_id: c.id, action: 'end' })} title="End campaign">
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => {
                      if (confirm('Delete this campaign? This will also remove it from Meta.')) {
                        controlMutation.mutate({ campaign_id: c.id, action: 'delete' });
                      }
                    }}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Verify dialog */}
      <Dialog open={verifyOpen} onOpenChange={setVerifyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Verify ads access</DialogTitle>
            <DialogDescription>Checking your Meta token and ad account…</DialogDescription>
          </DialogHeader>
          {verifying ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Talking to Meta…
            </div>
          ) : verifyResult ? (
            <div className="space-y-2 text-sm">
              <Check ok={verifyResult.token_ok} label="Token is valid" />
              <Check ok={verifyResult.has_ads_management} label="Has ads_management scope" />
              <Check ok={verifyResult.has_ads_read} label="Has ads_read scope" />
              <Check ok={verifyResult.ad_account_active} label={`Ad account active${verifyResult.ad_account_name ? ` (${verifyResult.ad_account_name})` : ''}`} />
              <Check ok={verifyResult.has_funding_source} label="Payment method on file" />
              {verifyResult.ad_account_currency && (
                <div className="text-xs text-muted-foreground">Currency: {verifyResult.ad_account_currency}</div>
              )}
              {verifyResult.issues?.length > 0 && (
                <div className="mt-3 p-3 rounded bg-destructive/10 text-destructive text-xs space-y-1">
                  {verifyResult.issues.map((i: string, idx: number) => <div key={idx}>• {i}</div>)}
                </div>
              )}
              {verifyResult.ready && (
                <div className="mt-3 p-3 rounded bg-green-500/10 text-green-700 dark:text-green-400 text-sm">
                  ✓ Ready to launch campaigns.
                </div>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setVerifyOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New campaign wizard */}
      {credential && (
        <NewCampaignDialog
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          credentialId={credential.id}
          companyId={selectedCompany.id}
          onCreated={() => qc.invalidateQueries({ queryKey: ['ad-campaigns'] })}
        />
      )}
    </div>
  );
};

const StatusBadge = ({ status }: { status: string }) => {
  const map: Record<string, string> = {
    ACTIVE: 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30',
    PAUSED: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30',
    ARCHIVED: 'bg-muted text-muted-foreground',
    FAILED: 'bg-destructive/15 text-destructive border-destructive/30',
    CREATING: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
    DELETED: 'bg-muted text-muted-foreground',
  };
  return <Badge variant="outline" className={`text-[10px] uppercase tracking-wide ${map[status] || ''}`}>{status}</Badge>;
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div className="text-muted-foreground">{label}</div>
    <div className="font-semibold text-foreground">{value}</div>
  </div>
);

const Check = ({ ok, label }: { ok: boolean; label: string }) => (
  <div className="flex items-center gap-2">
    {ok ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <X className="w-4 h-4 text-destructive" />}
    <span className={ok ? '' : 'text-muted-foreground'}>{label}</span>
  </div>
);

// ─── New campaign wizard ───
function NewCampaignDialog({
  open, onOpenChange, credentialId, companyId, onCreated,
}: { open: boolean; onOpenChange: (b: boolean) => void; credentialId: string; companyId: string; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('OUTCOME_TRAFFIC');
  const [dailyBudget, setDailyBudget] = useState('10');
  const [country, setCountry] = useState('ZM');
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(65);
  const [genders, setGenders] = useState<'all'|'male'|'female'>('all');
  const [message, setMessage] = useState('');
  const [link, setLink] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [cta, setCta] = useState('LEARN_MORE');
  const [endAt, setEndAt] = useState('');
  const [launching, setLaunching] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const dailyCents = Math.round(parseFloat(dailyBudget || '0') * 100);

  const submit = async (launch: boolean) => {
    if (!name || !message || dailyCents <= 0) return toast.error('Name, message, and budget are required.');
    if (dailyCents > 1_000_000) return toast.error('Daily budget exceeds the safety cap (10,000).');
    setLaunching(true);
    try {
      const { data, error } = await supabase.functions.invoke('meta-ads-launch', {
        body: {
          company_id: companyId,
          credential_id: credentialId,
          name, objective,
          daily_budget_cents: dailyCents,
          end_at: endAt ? new Date(endAt).toISOString() : undefined,
          targeting: {
            geo_countries: [country],
            age_min: ageMin, age_max: ageMax,
            genders: genders === 'male' ? [1] : genders === 'female' ? [2] : [],
            interests: [],
          },
          creative: {
            message,
            link: link || undefined,
            image_url: imageUrl || undefined,
            call_to_action: cta,
          },
          launch,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(launch ? 'Campaign launched!' : 'Draft saved (paused).');
      onCreated();
      onOpenChange(false);
      setConfirmOpen(false);
      // reset
      setName(''); setMessage(''); setLink(''); setImageUrl(''); setEndAt('');
    } catch (e: any) {
      toast.error(e.message || 'Launch failed');
    } finally {
      setLaunching(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Facebook Ads campaign</DialogTitle>
          <DialogDescription>Fill in the details. You can save as draft or launch live.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Campaign name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Blue Pans Promo" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Goal</Label>
              <Select value={objective} onValueChange={setObjective}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OBJECTIVES.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Daily budget (USD or account currency)</Label>
              <Input type="number" min="1" step="0.5" value={dailyBudget} onChange={(e) => setDailyBudget(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Country</Label>
              <Input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} placeholder="ZM" maxLength={2} />
            </div>
            <div className="space-y-1.5">
              <Label>Age min</Label>
              <Input type="number" min={13} max={65} value={ageMin} onChange={(e) => setAgeMin(parseInt(e.target.value || '18'))} />
            </div>
            <div className="space-y-1.5">
              <Label>Age max</Label>
              <Input type="number" min={13} max={65} value={ageMax} onChange={(e) => setAgeMax(parseInt(e.target.value || '65'))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Gender</Label>
            <Select value={genders} onValueChange={(v) => setGenders(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="male">Men only</SelectItem>
                <SelectItem value="female">Women only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Ad text</Label>
            <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What should the ad say?" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Destination link (optional)</Label>
              <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..." />
            </div>
            <div className="space-y-1.5">
              <Label>Call-to-action</Label>
              <Select value={cta} onValueChange={setCta}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CTA_OPTIONS.map(c => <SelectItem key={c} value={c}>{c.replace(/_/g,' ')}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Image URL (optional)</Label>
            <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://... (use a brand asset URL)" />
          </div>
          <div className="space-y-1.5">
            <Label>End date (optional)</Label>
            <Input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={launching}>Cancel</Button>
          <Button variant="secondary" onClick={() => submit(false)} disabled={launching}>
            {launching ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
            Save as draft
          </Button>
          <Button onClick={() => setConfirmOpen(true)} disabled={launching}>
            Launch live
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm launch</DialogTitle>
          <DialogDescription>
            You're about to spend up to <strong>{dailyBudget}</strong> per day{endAt ? ` until ${new Date(endAt).toLocaleDateString()}` : ' indefinitely (until you pause it)'}.
            Real money will be charged to your Meta ad account.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={launching}>Cancel</Button>
          <Button onClick={() => submit(true)} disabled={launching}>
            {launching ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
            Yes, launch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
