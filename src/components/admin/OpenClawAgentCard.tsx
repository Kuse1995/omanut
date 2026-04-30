import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Bot, Loader2, Activity } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';

interface Props {
  companyId: string;
  enabled: boolean; // legacy, ignored — we now use openclaw_mode
  onChanged?: () => void;
}

type Mode = 'off' | 'assist' | 'primary';

const SKILLS: { key: string; label: string; hint: string }[] = [
  { key: 'whatsapp', label: 'WhatsApp replies', hint: 'Inbound WA messages route to OpenClaw' },
  { key: 'meta_dm', label: 'Meta DMs', hint: 'Messenger + Instagram DMs route to OpenClaw' },
  { key: 'comments', label: 'Comments', hint: 'FB + IG comments route to OpenClaw' },
  { key: 'bms', label: 'BMS stock checks', hint: 'Internal AI cannot call BMS' },
  { key: 'content', label: 'Content & posting', hint: 'Internal AI cannot draft / schedule posts' },
  { key: 'handoff', label: 'Handoffs', hint: 'Internal AI cannot escalate to boss' },
];

export const OpenClawAgentCard = ({ companyId, onChanged }: Props) => {
  const queryClient = useQueryClient();

  const { data: company, refetch } = useQuery({
    queryKey: ['openclaw-company-config', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('id, openclaw_mode, openclaw_owns, openclaw_last_heartbeat, openclaw_webhook_url')
        .eq('id', companyId)
        .single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!companyId,
    refetchInterval: 15000,
  });

  const { data: events = [] } = useQuery({
    queryKey: ['openclaw-events', companyId],
    queryFn: async () => {
      const { data } = await supabase
        .from('openclaw_events')
        .select('id, channel, event_type, status, dispatch_status, created_at, answered_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(20);
      return data ?? [];
    },
    enabled: !!companyId,
    refetchInterval: 15000,
  });

  const [webhookUrl, setWebhookUrl] = useState('');
  useEffect(() => {
    if (company?.openclaw_webhook_url !== undefined) setWebhookUrl(company.openclaw_webhook_url ?? '');
  }, [company?.openclaw_webhook_url]);

  const mode: Mode = (company?.openclaw_mode as Mode) || 'off';
  const owns = (company?.openclaw_owns as Record<string, boolean>) || {};

  const setModeMutation = useMutation({
    mutationFn: async (next: Mode) => {
      const { error } = await supabase.from('companies').update({ openclaw_mode: next } as any).eq('id', companyId);
      if (error) throw error;
    },
    onSuccess: (_, next) => {
      toast.success(`OpenClaw mode → ${next}`);
      refetch();
      onChanged?.();
    },
    onError: (e: any) => toast.error(e.message || 'Failed'),
  });

  const setSkillMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: boolean }) => {
      const next = { ...owns, [key]: value };
      const { error } = await supabase.from('companies').update({ openclaw_owns: next } as any).eq('id', companyId);
      if (error) throw error;
    },
    onSuccess: () => refetch(),
    onError: (e: any) => toast.error(e.message || 'Failed'),
  });

  const setWebhookMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('companies')
        .update({ openclaw_webhook_url: webhookUrl.trim() || null } as any)
        .eq('id', companyId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Webhook URL saved');
      refetch();
    },
    onError: (e: any) => toast.error(e.message || 'Failed'),
  });

  const killSwitchMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('companies').update({ openclaw_mode: 'assist' } as any).eq('id', companyId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('OpenClaw demoted to assist — internal AI resumed');
      refetch();
    },
  });

  const heartbeat = company?.openclaw_last_heartbeat ? new Date(company.openclaw_last_heartbeat) : null;
  const ageMs = heartbeat ? Date.now() - heartbeat.getTime() : Infinity;
  const hbColor = ageMs < 5 * 60_000 ? 'bg-green-500' : ageMs < 30 * 60_000 ? 'bg-amber-500' : 'bg-red-500';
  const hbText = heartbeat ? formatDistanceToNow(heartbeat, { addSuffix: true }) : 'never';

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          OpenClaw Agent
        </CardTitle>
        <CardDescription>
          External brain. In <b>primary</b> mode, OpenClaw answers customers and our AI stays silent on the skills it owns.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Mode selector */}
        <div className="flex items-center gap-2">
          {(['off', 'assist', 'primary'] as Mode[]).map((m) => (
            <Button
              key={m}
              size="sm"
              variant={mode === m ? 'default' : 'outline'}
              disabled={setModeMutation.isPending}
              onClick={() => setModeMutation.mutate(m)}
              className="capitalize"
            >
              {m}
            </Button>
          ))}
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${hbColor}`} />
            heartbeat {hbText}
          </div>
        </div>

        {/* Webhook URL */}
        <div className="space-y-2">
          <Label htmlFor="oc-webhook" className="text-xs">OpenClaw inbound webhook URL</Label>
          <div className="flex gap-2">
            <Input
              id="oc-webhook"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://…/openclaw/webhook/{tenant}"
              className="text-xs"
            />
            <Button size="sm" onClick={() => setWebhookMutation.mutate()} disabled={setWebhookMutation.isPending}>
              Save
            </Button>
          </div>
        </div>

        {/* Skills */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Skills owned by OpenClaw</p>
          {SKILLS.map((s) => (
            <div key={s.key} className="flex items-center justify-between p-2 rounded border border-border">
              <div>
                <p className="text-sm">{s.label}</p>
                <p className="text-xs text-muted-foreground">{s.hint}</p>
              </div>
              <Switch
                checked={!!owns[s.key]}
                disabled={mode === 'off' || setSkillMutation.isPending}
                onCheckedChange={(v) => setSkillMutation.mutate({ key: s.key, value: v })}
              />
            </div>
          ))}
        </div>

        {/* Activity log */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Activity className="h-3 w-3" />
            <p className="text-xs font-medium text-muted-foreground">Recent events ({events.length})</p>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {events.length === 0 && <p className="text-xs text-muted-foreground italic">No events yet</p>}
            {events.map((e: any) => (
              <div key={e.id} className="text-xs flex items-center gap-2 p-1.5 rounded bg-muted/40">
                <Badge variant="outline" className="text-[10px]">{e.channel}</Badge>
                <span className="flex-1 truncate">{e.event_type}</span>
                <Badge
                  variant={e.status === 'pending' ? 'secondary' : 'default'}
                  className="text-[10px]"
                >
                  {e.status}
                </Badge>
                <span className="text-muted-foreground">{formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Kill switch */}
        {mode === 'primary' && (
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            disabled={killSwitchMutation.isPending}
            onClick={() => killSwitchMutation.mutate()}
          >
            {killSwitchMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            Kill switch — demote to assist
          </Button>
        )}
      </CardContent>
    </Card>
  );
};
