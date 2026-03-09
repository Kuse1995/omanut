import { useState, useEffect } from 'react';
import { useCompany } from '@/context/CompanyContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Trash2, AlertTriangle, Shield, Clock, Zap, ShoppingCart, Database, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import CompanyForm from '@/components/CompanyForm';
import { ApiKeysSection } from '@/components/admin/ApiKeysSection';

const SERVICE_MODES = [
  { value: 'autonomous', label: 'Autonomous', description: 'AI resolves everything automatically' },
  { value: 'human_first', label: 'Human-First', description: 'AI triages and routes to human agents' },
  { value: 'hybrid', label: 'Hybrid', description: 'AI handles simple queries, escalates complex ones' },
];

const SLA_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

export const CompanySettingsPanel = () => {
  const { selectedCompany, setSelectedCompany, refreshCompanies } = useCompany();
  const queryClient = useQueryClient();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Fetch AI overrides for service_mode
  const { data: aiOverrides } = useQuery({
    queryKey: ['ai-overrides-mode', selectedCompany?.id],
    queryFn: async () => {
      if (!selectedCompany?.id) return null;
      const { data, error } = await supabase
        .from('company_ai_overrides')
        .select('id, service_mode')
        .eq('company_id', selectedCompany.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!selectedCompany?.id,
  });

  // Fetch SLA config
  const { data: slaConfig } = useQuery({
    queryKey: ['sla-config', selectedCompany?.id],
    queryFn: async () => {
      if (!selectedCompany?.id) return [];
      const { data, error } = await supabase
        .from('company_sla_config')
        .select('*')
        .eq('company_id', selectedCompany.id)
        .order('priority');
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedCompany?.id,
  });

  // Update service mode
  const updateModeMutation = useMutation({
    mutationFn: async (mode: string) => {
      if (!selectedCompany?.id) return;
      if (aiOverrides?.id) {
        const { error } = await supabase
          .from('company_ai_overrides')
          .update({ service_mode: mode })
          .eq('company_id', selectedCompany.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('company_ai_overrides')
          .insert({ company_id: selectedCompany.id, service_mode: mode });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-overrides-mode'] });
      toast.success('Service mode updated');
    },
  });

  // Upsert SLA config
  const upsertSlaMutation = useMutation({
    mutationFn: async ({ priority, response, resolution, escalation }: { priority: string; response: number; resolution: number; escalation: number }) => {
      if (!selectedCompany?.id) return;
      const existing = (slaConfig || []).find((s: any) => s.priority === priority);
      if (existing) {
        const { error } = await supabase
          .from('company_sla_config')
          .update({ response_time_minutes: response, resolution_time_minutes: resolution, escalation_after_minutes: escalation })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('company_sla_config')
          .insert({ company_id: selectedCompany.id, priority, response_time_minutes: response, resolution_time_minutes: resolution, escalation_after_minutes: escalation });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sla-config'] });
      toast.success('SLA config saved');
    },
  });

  const handleDeleteCompany = async () => {
    if (!selectedCompany) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.rpc('delete_company', { p_company_id: selectedCompany.id });
      if (error) throw error;
      toast.success(`Company "${selectedCompany.name}" deleted successfully`);
      setSelectedCompany(null);
      refreshCompanies();
      setShowDeleteDialog(false);
    } catch (error: any) {
      console.error('Error deleting company:', error);
      toast.error(error.message || 'Failed to delete company');
    } finally {
      setDeleting(false);
    }
  };

  if (!selectedCompany) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Select a company to edit settings</p>
      </div>
    );
  }

  const currentMode = (aiOverrides as any)?.service_mode || 'autonomous';

  return (
    <>
      <ScrollArea className="h-full">
        <div className="p-6 space-y-8">
          <CompanyForm
            companyId={selectedCompany.id}
            onSuccess={() => window.location.reload()}
            onCancel={() => {}}
          />

          <Separator className="my-8" />

          {/* Service Mode */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                Service Mode
              </CardTitle>
              <CardDescription>
                Control how AI interacts with customers
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {SERVICE_MODES.map((mode) => (
                <div
                  key={mode.value}
                  className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                    currentMode === mode.value
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/30'
                  }`}
                  onClick={() => updateModeMutation.mutate(mode.value)}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{mode.label}</span>
                      {currentMode === mode.value && (
                        <Badge className="text-[10px]">Active</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{mode.description}</p>
                  </div>
                  <div className={`h-4 w-4 rounded-full border-2 ${
                    currentMode === mode.value ? 'border-primary bg-primary' : 'border-muted-foreground/30'
                  }`} />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Payments Toggle */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-primary" />
                Payment Configuration
              </CardTitle>
              <CardDescription>
                Disable in-chat payments for companies that sell products on external websites
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                <div>
                  <p className="font-medium text-sm">Disable WhatsApp Payments</p>
                  <p className="text-xs text-muted-foreground">
                    Turn on if this company handles payments outside WhatsApp (e.g. website checkout)
                  </p>
                </div>
                <Switch
                  checked={selectedCompany.payments_disabled ?? false}
                  onCheckedChange={async (checked) => {
                    const { error } = await supabase
                      .from('companies')
                      .update({ payments_disabled: checked })
                      .eq('id', selectedCompany.id);
                    if (error) {
                      toast.error('Failed to update payment setting');
                    } else {
                      toast.success(checked ? 'Payments disabled' : 'Payments enabled');
                      refreshCompanies();
                    }
                  }}
                />
              </div>
            </CardContent>
          </Card>

          {/* SLA Configuration */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                SLA Configuration
              </CardTitle>
              <CardDescription>
                Set response and resolution targets by priority
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {SLA_PRIORITIES.map((priority) => {
                  const config = (slaConfig || []).find((s: any) => s.priority === priority);
                  const defaults = { low: [120, 480, 240], medium: [30, 240, 60], high: [15, 120, 30], urgent: [5, 60, 15] };
                  const [r, res, esc] = defaults[priority as keyof typeof defaults] || [30, 240, 60];

                  return (
                    <SLARow
                      key={priority}
                      priority={priority}
                      responseTime={config?.response_time_minutes ?? r}
                      resolutionTime={config?.resolution_time_minutes ?? res}
                      escalationTime={config?.escalation_after_minutes ?? esc}
                      onSave={(response, resolution, escalation) =>
                        upsertSlaMutation.mutate({ priority, response, resolution, escalation })
                      }
                    />
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Separator className="my-8" />

          <ApiKeysSection />

          <Separator className="my-8" />

          {/* Danger Zone */}
          <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-6">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <h3 className="text-lg font-semibold text-destructive">Danger Zone</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Permanently delete this company and all associated data including conversations,
              messages, reservations, payments, and user accounts. This action cannot be undone.
            </p>
            <Button variant="destructive" onClick={() => setShowDeleteDialog(true)} className="gap-2">
              <Trash2 className="h-4 w-4" />
              Delete Company
            </Button>
          </div>
        </div>
      </ScrollArea>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete "{selectedCompany.name}"?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>This will permanently delete:</p>
              <ul className="list-disc list-inside text-sm space-y-1 ml-2">
                <li>All conversations and messages</li>
                <li>All reservations and payments</li>
                <li>All media, documents, and AI settings</li>
                <li>User accounts (if not linked to other companies)</li>
              </ul>
              <p className="font-medium text-destructive mt-4">
                This action cannot be undone. Deleted emails can be reused.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCompany}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Deleting...' : 'Delete Company'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

// SLA Row sub-component
function SLARow({ priority, responseTime, resolutionTime, escalationTime, onSave }: {
  priority: string;
  responseTime: number;
  resolutionTime: number;
  escalationTime: number;
  onSave: (r: number, res: number, esc: number) => void;
}) {
  const [r, setR] = useState(responseTime);
  const [res, setRes] = useState(resolutionTime);
  const [esc, setEsc] = useState(escalationTime);
  const dirty = r !== responseTime || res !== resolutionTime || esc !== escalationTime;

  const priorityColors: Record<string, string> = {
    low: 'text-muted-foreground',
    medium: 'text-primary',
    high: 'text-orange-500',
    urgent: 'text-destructive',
  };

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border">
      <span className={`font-medium text-sm capitalize w-16 ${priorityColors[priority]}`}>{priority}</span>
      <div className="flex-1 grid grid-cols-3 gap-2">
        <div>
          <Label className="text-[10px] text-muted-foreground">Response (min)</Label>
          <Input type="number" value={r} onChange={(e) => setR(Number(e.target.value))} className="h-7 text-xs" />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Resolution (min)</Label>
          <Input type="number" value={res} onChange={(e) => setRes(Number(e.target.value))} className="h-7 text-xs" />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Escalate (min)</Label>
          <Input type="number" value={esc} onChange={(e) => setEsc(Number(e.target.value))} className="h-7 text-xs" />
        </div>
      </div>
      {dirty && (
        <Button size="sm" className="h-7 text-xs" onClick={() => onSave(r, res, esc)}>
          Save
        </Button>
      )}
    </div>
  );
}
