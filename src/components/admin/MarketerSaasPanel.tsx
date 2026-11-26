import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Plus,
  Copy,
  ExternalLink,
  DollarSign,
  Send,
  RefreshCw,
  CheckCircle2,
  Users,
  CalendarClock,
  Sparkles,
  Loader2,
  Edit2,
  Play,
  Smartphone,
} from 'lucide-react';
import type { A2UISurfaceType } from './marketer-types';

interface MarketerPlan {
  id: string;
  slug: string;
  name: string;
  currency: string;
  default_setup_fee: number;
  default_monthly_fee: number;
  monthly_posts_limit: number;
  monthly_images_limit: number;
  monthly_videos_limit: number;
}

interface MarketerSubscription {
  id: string;
  company_id: string;
  plan_id: string | null;
  primary_whatsapp_phone: string;
  contact_name: string | null;
  status: 'setup_pending' | 'active' | 'grace_period' | 'paused' | 'cancelled';
  currency: string;
  setup_fee_amount: number;
  setup_fee_paid: boolean;
  monthly_fee_amount: number;
  current_period_end: string;
  monthly_posts_limit: number;
  monthly_images_limit: number;
  monthly_videos_limit: number;
  usage_posts_used: number;
  usage_images_used: number;
  usage_videos_used: number;
  autopilot_level: 'copilot' | 'weekly_batch' | 'full_autopilot';
  notes: string | null;
  companies: {
    id: string;
    name: string;
    business_type: string | null;
  } | null;
  connected_meta: Array<{ page_name: string | null; ig_user_id: string | null }>;
  connected_social: string[];
  vault_ready_count: number;
  post_counts: { queued: number; published: number };
}

interface MarketerPayment {
  id: string;
  company_id: string;
  payment_type: string;
  amount: number;
  currency: string;
  provider: string;
  reference_code: string | null;
  paid_at: string;
  companies: { name: string } | null;
}

interface OverviewData {
  subscriptions: MarketerSubscription[];
  payments: MarketerPayment[];
  plans: MarketerPlan[];
}

export function MarketerSaasPanel() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Provision client dialog
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [provMode, setProvMode] = useState<'create_new' | 'attach_existing'>('create_new');
  const [existingCompanyId, setExistingCompanyId] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [businessType, setBusinessType] = useState('retail / services');
  const [services, setServices] = useState('');
  const [contactName, setContactName] = useState('');
  const [waPhone, setWaPhone] = useState('+260');
  const [setupFee, setSetupFee] = useState('750');
  const [monthlyFee, setMonthlyFee] = useState('500');
  const [postsLimit, setPostsLimit] = useState('16');
  const [imagesLimit, setImagesLimit] = useState('15');
  const [videosLimit, setVideosLimit] = useState('4');
  const [autopilot, setAutopilot] = useState<'copilot' | 'weekly_batch' | 'full_autopilot'>('copilot');
  const [brandTone, setBrandTone] = useState('Warm, vibrant, trustworthy');
  const [setupPaidNow, setSetupPaidNow] = useState(true);
  const [initialAmount, setInitialAmount] = useState('1250');
  const [momoRef, setMomoRef] = useState('');
  const [sendWelcomeWa, setSendWelcomeWa] = useState(true);
  const [provBusy, setProvBusy] = useState(false);
  const [createdStudioUrl, setCreatedStudioUrl] = useState<string | null>(null);

  // Payment dialog
  const [paySub, setPaySub] = useState<MarketerSubscription | null>(null);
  const [payType, setPayType] = useState<'monthly_renewal' | 'setup_fee' | 'setup_and_first_month' | 'topup'>('monthly_renewal');
  const [payAmount, setPayAmount] = useState('');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [extendMonth, setExtendMonth] = useState(true);
  const [sendReceiptWa, setSendReceiptWa] = useState(true);
  const [payBusy, setPayBusy] = useState(false);

  // Edit dialog
  const [editSub, setEditSub] = useState<MarketerSubscription | null>(null);
  const [editStatus, setEditStatus] = useState<string>('active');
  const [editMonthlyFee, setEditMonthlyFee] = useState('');
  const [editPostsLimit, setEditPostsLimit] = useState('');
  const [editImagesLimit, setEditImagesLimit] = useState('');
  const [editVideosLimit, setEditVideosLimit] = useState('');
  const [editAutopilot, setEditAutopilot] = useState<string>('copilot');
  const [editPhone, setEditPhone] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  // Quick studio link modal
  const [studioModalUrl, setStudioModalUrl] = useState<string | null>(null);
  const [studioModalTitle, setStudioModalTitle] = useState('');

  const { data: overview, isLoading, refetch } = useQuery({
    queryKey: ['admin-marketer-overview'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('admin-ops', {
        body: { action: 'list_marketer_overview' },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Failed to load Marketer SaaS');
      return data as OverviewData;
    },
  });

  const { data: allCompanies = [] } = useQuery({
    queryKey: ['admin-companies-brief'],
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('id, name').order('name');
      if (error) return [];
      return data || [];
    },
  });

  const subs = useMemo(() => overview?.subscriptions || [], [overview]);
  const payments = useMemo(() => overview?.payments || [], [overview]);
  const plans = useMemo(() => overview?.plans || [], [overview]);

  const kpis = useMemo(() => {
    const active = subs.filter((s) => s.status === 'active').length;
    const graceOrPaused = subs.filter((s) => s.status === 'grace_period' || s.status === 'paused').length;
    const totalCollected = payments.reduce((acc, p) => acc + Number(p.amount || 0), 0);
    const dueSoon = subs.filter((s) => {
      const days = Math.ceil((Date.parse(s.current_period_end) - Date.now()) / 86_400_000);
      return s.status === 'active' && days <= 7;
    }).length;
    return { active, graceOrPaused, totalCollected, dueSoon };
  }, [subs, payments]);

  const filteredSubs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return subs.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (!q) return true;
      const hay = `${s.companies?.name || ''} ${s.contact_name || ''} ${s.primary_whatsapp_phone}`.toLowerCase();
      return hay.includes(q);
    });
  }, [subs, search, statusFilter]);

  const applyPlanPreset = (p: MarketerPlan) => {
    setSetupFee(String(p.default_setup_fee));
    setMonthlyFee(String(p.default_monthly_fee));
    setPostsLimit(String(p.monthly_posts_limit));
    setImagesLimit(String(p.monthly_images_limit));
    setVideosLimit(String(p.monthly_videos_limit));
    setInitialAmount(String(p.default_setup_fee + p.default_monthly_fee));
  };

  const handleProvision = async () => {
    setProvBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-ops', {
        body: {
          action: 'provision_marketer_client',
          mode: provMode,
          company_id: provMode === 'attach_existing' ? existingCompanyId : undefined,
          company_name: companyName,
          business_type: businessType,
          services,
          contact_name: contactName,
          primary_whatsapp_phone: waPhone,
          setup_fee_amount: Number(setupFee || 0),
          monthly_fee_amount: Number(monthlyFee || 0),
          setup_fee_paid: setupPaidNow,
          initial_payment_amount: setupPaidNow ? Number(initialAmount || 0) : 0,
          reference_code: momoRef,
          monthly_posts_limit: Number(postsLimit || 16),
          monthly_images_limit: Number(imagesLimit || 15),
          monthly_videos_limit: Number(videosLimit || 4),
          autopilot_level: autopilot,
          brand_tone: brandTone,
          send_welcome_whatsapp: sendWelcomeWa,
        },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Provisioning failed');
      setCreatedStudioUrl(data.studio_url);
      toast.success(
        data.whatsapp_sent
          ? 'Client provisioned & WhatsApp welcome sent!'
          : 'Client provisioned! Use the Setup Studio link below.'
      );
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Provision failed');
    } finally {
      setProvBusy(false);
    }
  };

  const handleRecordPayment = async () => {
    if (!paySub) return;
    setPayBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-ops', {
        body: {
          action: 'record_marketer_payment',
          subscription_id: paySub.id,
          payment_type: payType,
          amount: Number(payAmount || 0),
          provider: 'manual_momo',
          reference_code: payRef,
          notes: payNotes,
          extend_month: extendMonth,
          send_whatsapp_receipt: sendReceiptWa,
        },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Payment failed');
      toast.success(data.whatsapp_sent ? 'Payment recorded & WhatsApp receipt sent!' : 'Payment recorded!');
      setPaySub(null);
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record payment');
    } finally {
      setPayBusy(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editSub) return;
    setEditBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-ops', {
        body: {
          action: 'update_marketer_subscription',
          subscription_id: editSub.id,
          status: editStatus,
          monthly_fee_amount: Number(editMonthlyFee || 0),
          monthly_posts_limit: Number(editPostsLimit || 16),
          monthly_images_limit: Number(editImagesLimit || 15),
          monthly_videos_limit: Number(editVideosLimit || 4),
          autopilot_level: editAutopilot,
          primary_whatsapp_phone: editPhone,
          notes: editNotes,
        },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Update failed');
      toast.success('Subscription updated');
      setEditSub(null);
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setEditBusy(false);
    }
  };

  const openOrSendStudio = async (sub: MarketerSubscription, surface: A2UISurfaceType, sendWa: boolean) => {
    try {
      const { data, error } = await supabase.functions.invoke('admin-ops', {
        body: {
          action: 'mint_client_studio_link',
          subscription_id: sub.id,
          surface_type: surface,
          send_whatsapp: sendWa,
        },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Failed to generate link');
      if (sendWa) {
        toast.success(data.whatsapp_sent ? 'Studio link sent to WhatsApp!' : 'Link minted (WhatsApp send skipped)');
      } else {
        setStudioModalTitle(`${sub.companies?.name || 'Client'} — ${surface.replace(/_/g, ' ')}`);
        setStudioModalUrl(data.studio_url);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    }
  };

  const triggerRitual = async (sub: MarketerSubscription, jobType: 'monday_kickoff' | 'friday_digest') => {
    try {
      const { data, error } = await supabase.functions.invoke('admin-ops', {
        body: {
          action: 'trigger_marketer_ritual',
          company_id: sub.company_id,
          job_type: jobType,
        },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Failed');
      toast.success(`Triggered ${jobType.replace(/_/g, ' ')} on WhatsApp!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Trigger failed');
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Smartphone className="w-6 h-6 text-primary" />
            WhatsApp Social Marketer SaaS
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            In-person client provisioning, manual MoMo collection, shared WhatsApp Hub routing & 1-click Mobile Studio links.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            onClick={() => {
              setCreatedStudioUrl(null);
              setProvisionOpen(true);
            }}
            className="gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Pitch & Provision Client
          </Button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs">
              <Users className="w-3.5 h-3.5 text-emerald-500" />
              Active Marketer Clients
            </CardDescription>
            <CardTitle className="text-2xl">{kpis.active}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs">
              <DollarSign className="w-3.5 h-3.5 text-primary" />
              Manual MoMo Collected
            </CardDescription>
            <CardTitle className="text-2xl">ZMW {kpis.totalCollected.toLocaleString()}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs">
              <CalendarClock className="w-3.5 h-3.5 text-amber-500" />
              Renewals Due ≤7 Days
            </CardDescription>
            <CardTitle className="text-2xl">{kpis.dueSoon}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs">
              <Sparkles className="w-3.5 h-3.5 text-muted-foreground" />
              Grace / Paused
            </CardDescription>
            <CardTitle className="text-2xl">{kpis.graceOrPaused}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search client business, contact, or WhatsApp number..."
          className="max-w-sm"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="grace_period">Grace Period</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="setup_pending">Setup Pending</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Subscribers List */}
      <div className="space-y-3">
        {filteredSubs.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center text-sm text-muted-foreground">
              {isLoading
                ? 'Loading Social Marketer subscribers...'
                : 'No Marketer SaaS clients yet. Click "Pitch & Provision Client" during your next meeting to launch one in 30 seconds.'}
            </CardContent>
          </Card>
        ) : (
          filteredSubs.map((sub) => {
            const daysLeft = Math.ceil((Date.parse(sub.current_period_end) - Date.now()) / 86_400_000);
            const hasMeta = sub.connected_meta.length > 0;
            return (
              <Card key={sub.id}>
                <CardContent className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-base">{sub.companies?.name || 'Unknown Business'}</span>
                      <Badge
                        variant={sub.status === 'active' ? 'default' : sub.status === 'grace_period' ? 'secondary' : 'destructive'}
                        className="capitalize text-[11px]"
                      >
                        {sub.status.replace(/_/g, ' ')}
                      </Badge>
                      <Badge variant="outline" className="text-[11px] capitalize">
                        {sub.autopilot_level.replace(/_/g, ' ')}
                      </Badge>
                      <Badge variant="outline" className="text-[11px]">
                        +{sub.primary_whatsapp_phone}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {sub.contact_name ? `${sub.contact_name} • ` : ''}
                      Setup: {sub.currency} {sub.setup_fee_amount} ({sub.setup_fee_paid ? 'Paid' : 'Unpaid'}) • Monthly: {sub.currency} {sub.monthly_fee_amount}/mo •{' '}
                      <span className={daysLeft <= 5 ? 'text-amber-500 font-medium' : ''}>
                        {daysLeft >= 0 ? `${daysLeft}d left` : `${Math.abs(daysLeft)}d overdue`}
                      </span>
                    </p>
                    <div className="flex items-center gap-2 flex-wrap pt-1 text-[11px]">
                      <Badge variant="secondary">Posts {sub.usage_posts_used}/{sub.monthly_posts_limit}</Badge>
                      <Badge variant="secondary">Images {sub.usage_images_used}/{sub.monthly_images_limit}</Badge>
                      <Badge variant="secondary">Reels {sub.usage_videos_used}/{sub.monthly_videos_limit}</Badge>
                      <Badge variant="secondary">Vault {sub.vault_ready_count} ready</Badge>
                      {hasMeta ? (
                        <Badge className="bg-emerald-600 text-white gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          FB{sub.connected_meta.some((m) => m.ig_user_id) ? '+IG' : ''}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-amber-500 border-amber-500/40">
                          Social Not Connected
                        </Badge>
                      )}
                      {sub.connected_social.map((plat) => (
                        <Badge key={plat} className="bg-emerald-600 text-white capitalize">{plat}</Badge>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => openOrSendStudio(sub, 'onboarding_hub', false)}
                      className="gap-1 text-xs"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Setup Studio
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openOrSendStudio(sub, 'vault_uploader', true)}
                      className="gap-1 text-xs"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Send Vault Link
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setPaySub(sub);
                        setPayType('monthly_renewal');
                        setPayAmount(String(sub.monthly_fee_amount || 500));
                        setPayRef('');
                        setPayNotes('');
                        setExtendMonth(true);
                      }}
                      className="gap-1 text-xs"
                    >
                      <DollarSign className="w-3.5 h-3.5" />
                      Record MoMo
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => triggerRitual(sub, 'monday_kickoff')}
                      title="Send Monday Strategy Kickoff now"
                      className="gap-1 text-xs"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Kickoff
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditSub(sub);
                        setEditStatus(sub.status);
                        setEditMonthlyFee(String(sub.monthly_fee_amount));
                        setEditPostsLimit(String(sub.monthly_posts_limit));
                        setEditImagesLimit(String(sub.monthly_images_limit));
                        setEditVideosLimit(String(sub.monthly_videos_limit));
                        setEditAutopilot(sub.autopilot_level);
                        setEditPhone(sub.primary_whatsapp_phone);
                        setEditNotes(sub.notes || '');
                      }}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Recent Payments Ledger */}
      {payments.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent Manual MoMo & Setup Payments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {payments.slice(0, 10).map((p) => (
              <div key={p.id} className="flex items-center justify-between text-xs py-2 border-b last:border-b-0">
                <div>
                  <span className="font-medium">{p.companies?.name || 'Client'}</span>
                  <span className="text-muted-foreground"> — {p.payment_type.replace(/_/g, ' ')}</span>
                  {p.reference_code ? <span className="text-muted-foreground"> (Ref: {p.reference_code})</span> : null}
                </div>
                <div className="font-semibold text-emerald-500">
                  +{p.currency} {Number(p.amount).toLocaleString()}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Dialog: Provision Client */}
      <Dialog open={provisionOpen} onOpenChange={setProvisionOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pitch & Provision Social Marketer Client</DialogTitle>
            <DialogDescription>
              Zero-disruption enrollment: creates an isolated Marketer workspace & sends them a zero-login Mobile Studio link.
            </DialogDescription>
          </DialogHeader>

          {createdStudioUrl ? (
            <div className="space-y-4 py-2">
              <div className="p-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 space-y-2">
                <p className="font-semibold text-sm flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  Client Ready! Open this Setup Studio right beside them or copy it:
                </p>
                <p className="text-xs font-mono break-all bg-background p-2 rounded border">{createdStudioUrl}</p>
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(createdStudioUrl);
                      toast.success('Copied link!');
                    }}
                    className="gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copy Link
                  </Button>
                  <Button size="sm" onClick={() => window.open(createdStudioUrl, '_blank')} className="gap-1.5">
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open Setup Studio Now
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => setProvisionOpen(false)}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 py-1">
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={provMode === 'create_new' ? 'default' : 'outline'}
                  onClick={() => setProvMode('create_new')}
                >
                  New Marketer Client
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={provMode === 'attach_existing' ? 'default' : 'outline'}
                  onClick={() => setProvMode('attach_existing')}
                >
                  Attach to Existing Company
                </Button>
              </div>

              {provMode === 'attach_existing' ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Existing Company</Label>
                  <Select value={existingCompanyId} onValueChange={setExistingCompanyId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a company..." />
                    </SelectTrigger>
                    <SelectContent>
                      {allCompanies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Business Name *</Label>
                    <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Lusaka Grill House" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Business Type</Label>
                    <Input value={businessType} onChange={(e) => setBusinessType(e.target.value)} placeholder="Restaurant, Boutique, Salon..." />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs">Products / Services Summary</Label>
                    <Textarea value={services} onChange={(e) => setServices(e.target.value)} rows={2} placeholder="What do they sell, key prices, location?" />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Owner / Contact Name</Label>
                  <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Chanda / Mwansa" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Client WhatsApp Phone *</Label>
                  <Input value={waPhone} onChange={(e) => setWaPhone(e.target.value)} placeholder="+26097..." />
                </div>
              </div>

              {plans.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Quick-fill Preset (optional — you control exact pricing)</Label>
                  <div className="flex gap-2 flex-wrap">
                    {plans.map((p) => (
                      <Button key={p.id} type="button" size="sm" variant="outline" onClick={() => applyPlanPreset(p)} className="text-xs">
                        {p.name} ({p.currency} {p.default_setup_fee}+{p.default_monthly_fee})
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">Setup Fee</Label>
                  <Input type="number" value={setupFee} onChange={(e) => setSetupFee(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Monthly Fee</Label>
                  <Input type="number" value={monthlyFee} onChange={(e) => setMonthlyFee(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Posts / mo</Label>
                  <Input type="number" value={postsLimit} onChange={(e) => setPostsLimit(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Images / mo</Label>
                  <Input type="number" value={imagesLimit} onChange={(e) => setImagesLimit(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Reels / mo</Label>
                  <Input type="number" value={videosLimit} onChange={(e) => setVideosLimit(e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Brand Tone</Label>
                  <Input value={brandTone} onChange={(e) => setBrandTone(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Autopilot Level</Label>
                  <Select value={autopilot} onValueChange={(v) => setAutopilot(v as typeof autopilot)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="copilot">Co-Pilot (Approve every post)</SelectItem>
                      <SelectItem value="weekly_batch">Weekly Batch (Approve Mondays)</SelectItem>
                      <SelectItem value="full_autopilot">Full Autopilot (2h Veto)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2 border rounded-lg p-3 bg-muted/30">
                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <Checkbox checked={setupPaidNow} onCheckedChange={(v) => setSetupPaidNow(Boolean(v))} />
                  Setup fee / first payment collected via MoMo now
                </label>
                {setupPaidNow && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <Input type="number" value={initialAmount} onChange={(e) => setInitialAmount(e.target.value)} placeholder="Amount collected (ZMW)" />
                    <Input value={momoRef} onChange={(e) => setMomoRef(e.target.value)} placeholder="MoMo Ref / TXN ID (optional)" />
                  </div>
                )}
                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer pt-1">
                  <Checkbox checked={sendWelcomeWa} onCheckedChange={(v) => setSendWelcomeWa(Boolean(v))} />
                  Send WhatsApp Welcome + Setup Studio link immediately
                </label>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setProvisionOpen(false)}>Cancel</Button>
                <Button onClick={handleProvision} disabled={provBusy}>
                  {provBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
                  Create & Launch
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog: Record MoMo Payment */}
      <Dialog open={Boolean(paySub)} onOpenChange={(o) => !o && setPaySub(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Manual MoMo Payment — {paySub?.companies?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label className="text-xs">Payment Type</Label>
              <Select value={payType} onValueChange={(v) => setPayType(v as typeof payType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly_renewal">Monthly Renewal</SelectItem>
                  <SelectItem value="setup_fee">Setup Fee</SelectItem>
                  <SelectItem value="setup_and_first_month">Setup + First Month</SelectItem>
                  <SelectItem value="topup">Reel / Quota Top-Up</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Amount ({paySub?.currency || 'ZMW'})</Label>
                <Input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">MoMo Reference</Label>
                <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Optional TXN ID" />
              </div>
            </div>
            <Input value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="Notes (optional)" />
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox checked={extendMonth} onCheckedChange={(v) => setExtendMonth(Boolean(v))} />
              Extend active period by +30 days & reset monthly usage counters
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox checked={sendReceiptWa} onCheckedChange={(v) => setSendReceiptWa(Boolean(v))} />
              Send payment confirmation on WhatsApp
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaySub(null)}>Cancel</Button>
            <Button onClick={handleRecordPayment} disabled={payBusy}>
              {payBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
              Save Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Edit Subscription */}
      <Dialog open={Boolean(editSub)} onOpenChange={(o) => !o && setEditSub(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Client Plan — {editSub?.companies?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="grace_period">Grace Period</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                    <SelectItem value="setup_pending">Setup Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Autopilot Level</Label>
                <Select value={editAutopilot} onValueChange={setEditAutopilot}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="copilot">Co-Pilot</SelectItem>
                    <SelectItem value="weekly_batch">Weekly Batch</SelectItem>
                    <SelectItem value="full_autopilot">Full Autopilot</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">WhatsApp Phone</Label>
                <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Monthly Fee ({editSub?.currency || 'ZMW'})</Label>
                <Input type="number" value={editMonthlyFee} onChange={(e) => setEditMonthlyFee(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Posts / mo</Label>
                <Input type="number" value={editPostsLimit} onChange={(e) => setEditPostsLimit(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Images / mo</Label>
                <Input type="number" value={editImagesLimit} onChange={(e) => setEditImagesLimit(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Reels / mo</Label>
                <Input type="number" value={editVideosLimit} onChange={(e) => setEditVideosLimit(e.target.value)} />
              </div>
            </div>
            <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={2} placeholder="Internal notes..." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditSub(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={editBusy}>
              {editBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: View Studio Link */}
      <Dialog open={Boolean(studioModalUrl)} onOpenChange={(o) => !o && setStudioModalUrl(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{studioModalTitle}</DialogTitle>
            <DialogDescription>Open right on your phone/tablet during setup, or copy and share with the client.</DialogDescription>
          </DialogHeader>
          {studioModalUrl && (
            <div className="space-y-3">
              <p className="text-xs font-mono break-all bg-muted p-3 rounded border">{studioModalUrl}</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(studioModalUrl);
                    toast.success('Copied link!');
                  }}
                  className="gap-1.5"
                >
                  <Copy className="w-4 h-4" />
                  Copy
                </Button>
                <Button onClick={() => window.open(studioModalUrl, '_blank')} className="gap-1.5 flex-1">
                  <ExternalLink className="w-4 h-4" />
                  Open Studio
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
