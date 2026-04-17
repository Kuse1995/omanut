import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Bot, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface Props {
  companyId: string;
  enabled: boolean;
  onChanged?: () => void;
}

export const OpenClawAgentCard = ({ companyId, enabled, onChanged }: Props) => {
  const queryClient = useQueryClient();

  // Live count of conversations currently under OpenClaw control.
  // We treat any active human takeover as "OpenClaw-driven" while the toggle is ON,
  // since OpenClaw is the only external agent that can drive takeover via MCP.
  const { data: activeCount = 0 } = useQuery({
    queryKey: ['openclaw-active-count', companyId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('human_takeover', true);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!companyId,
    refetchInterval: 15000,
  });

  const toggleMutation = useMutation({
    mutationFn: async (next: boolean) => {
      const { error } = await supabase
        .from('companies')
        .update({ openclaw_takeover_enabled: next } as any)
        .eq('id', companyId);
      if (error) throw error;

      // Kill switch: when turning OFF, release all active OpenClaw takeovers
      // so the AI can resume immediately.
      if (!next) {
        const { error: relErr } = await supabase
          .from('conversations')
          .update({ human_takeover: false, takeover_at: null, takeover_by: null })
          .eq('company_id', companyId)
          .eq('human_takeover', true);
        if (relErr) throw relErr;
      }
    },
    onSuccess: (_, next) => {
      toast.success(
        next
          ? 'OpenClaw can now handle conversations'
          : 'OpenClaw disabled — all active takeovers released, AI resumed'
      );
      queryClient.invalidateQueries({ queryKey: ['openclaw-active-count', companyId] });
      onChanged?.();
    },
    onError: (e: any) => toast.error(e.message || 'Failed to update OpenClaw setting'),
  });

  const releaseAllMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('conversations')
        .update({ human_takeover: false, takeover_at: null, takeover_by: null })
        .eq('company_id', companyId)
        .eq('human_takeover', true);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('All OpenClaw conversations released — AI resumed');
      queryClient.invalidateQueries({ queryKey: ['openclaw-active-count', companyId] });
    },
    onError: (e: any) => toast.error(e.message || 'Failed to release conversations'),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          OpenClaw Agent
        </CardTitle>
        <CardDescription>
          Manual on/off switch for the external OpenClaw MCP agent
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between p-3 rounded-lg border border-border">
          <div className="pr-4">
            <p className="font-medium text-sm">Allow OpenClaw to handle conversations</p>
            <p className="text-xs text-muted-foreground">
              When off, OpenClaw can read data but cannot send messages or take over chats.
              Turning off also releases any active OpenClaw takeovers back to the AI.
            </p>
          </div>
          <Switch
            checked={enabled}
            disabled={toggleMutation.isPending}
            onCheckedChange={(checked) => toggleMutation.mutate(checked)}
          />
        </div>

        <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/40">
          <div>
            <p className="text-sm">
              Currently:{' '}
              <span className="font-semibold text-foreground">
                {activeCount}
              </span>{' '}
              {activeCount === 1 ? 'conversation' : 'conversations'} under human/OpenClaw control
            </p>
            <p className="text-xs text-muted-foreground">
              Use the kill-switch if OpenClaw needs to be stopped immediately.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={activeCount === 0 || releaseAllMutation.isPending}
            onClick={() => releaseAllMutation.mutate()}
          >
            {releaseAllMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : null}
            Release all
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
